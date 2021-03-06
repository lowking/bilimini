const ipc = require('electron').ipcRenderer;
const remote = require('electron').remote;
const dialog = remote.dialog;
const shell = require('electron').shell;
const appData = require('./package.json');
const utils = require('./js/utils.js');
const userAgent = {
  desktop: 'bilimini Desktop like Mozilla/233 (Windows NT or OSX) AppleWebKit like Gecko or not (Chrome and Safari both OK)',
  mobile: 'bilimini Mobile like (iPhone or Android) whatever AppleWebKit/124.50 Mobile/BI233'
};
const videoUrlPrefix = 'https://www.bilibili.com/video/';
const liveUrlPrefix  = 'https://live.bilibili.com/blanc/';
let wv, wrapper, topbar;
let _isLastNavigatePartSelect = false;
let _isLastestVersionChecked = false;
let clickTimer;
const homeUrl = utils.config.get('homeUrl');
const homeUserAgent = utils.config.get('userAgent');

// 保存用户浏览记录
let _lastNavigation = new Date();
var _history = {
  stack: [homeUrl],
  pos: 0,
  go: function(target, noNewHistory, openType) {
    // 显示loading mask
    wrapper.classList.add('loading');
    let vid = utils.getVid(target);
    let live;
    // 如果两次转跳的时间间隔小于3s，就认为是B站发起的redirect
    // 这时为保证后退时不会陷入循环，手动删除一条历史
    const now = new Date();
    if( now - _lastNavigation < 3000 ) {
      utils.log('两次转跳间隔小于3s，疑似redirect');
      _history.pop();
    }
    _lastNavigation = now;
    if( vid ) {
      // case 1 普通视频播放页，转跳对应pc页
      wv.loadURL(videoUrlPrefix + vid, {
        userAgent: userAgent.desktop
      });
      !noNewHistory && _history.add(videoUrlPrefix + vid);
      v.disableDanmakuButton = false;
      utils.log(`路由：类型① 视频详情页\n原地址：${target}\n转跳地址：${videoUrlPrefix+vid}`);
    } else if( target.indexOf('bangumi/play/') > -1 ) {
      // case 2 番剧播放页
      wv.loadURL(target, {
        userAgent: userAgent.desktop
      });
      !noNewHistory && _history.add(target);
      v.disableDanmakuButton = false;
      utils.log(`路由：类型② 番剧播放页\n地址：${target}`);
    } else if ( live = /live\.bilibili\.com\/(h5\/||blanc\/)?(\d+).*/.exec(target) ) {
      wv.loadURL(liveUrlPrefix + live[2], {
        userAgent: userAgent.desktop
      });
      !noNewHistory && _history.add(liveUrlPrefix + live[2]);
      v.disableDanmakuButton = false;
      utils.log(`路由：类型③ 直播页面\n原地址：${target}\n转跳地址：${liveUrlPrefix+live[2]}`);
    } else {
      // 我们假设html5player的页面都是通过inject.js转跳进入的，所以删除上一条历史记录来保证goBack操作的正确
      // 如果用户自己输入一个html5player的播放地址，那就管不了了
      if (openType == "d" ||
        target.indexOf('html5player.html') > -1 ||
        target.indexOf('authorize') > -1) {
        // html5player.html有防盗链验证，ua似乎必须是桌面浏览器
        wv.loadURL(target, {
          userAgent: userAgent.desktop
        });
        !noNewHistory && _history.add(target);
        _history.replace(target);
      } else {
        // b站首页
        if (target.indexOf('bilibili.com') > -1) {
          if (Number(utils.config.get(`isUsePcVersion`)) === 1) {
            _history.go(target, null, "d");
          } else {
            // 其他链接不做操作直接打开
            wv.loadURL(target, {
              userAgent: userAgent.mobile
            });
          }
        } else {
          // 其他链接不做操作直接打开
          wv.loadURL(target, {
            userAgent: userAgent.mobile
          });
        }
        !noNewHistory && _history.add(target);
        // 清除分p
        ipc.send('update-part', null);
      }
      v.disableDanmakuButton = true;
      utils.log(`路由：类型④ 未归类\n原地址：${target}\n转跳地址：${target}`);
    }
  },
  goPart: function(pid) {
    wrapper.classList.add('loading');
    _isLastNavigatePartSelect = true;
    // 因为utils.getVid返回的地址是通用的，里面可能已经带了/?p=，所以这里我们单独获取吧
    const url = wv.getURL();
    const m = /av\d+/.exec(url) || /BV\w+/.exec(url);
    if(m) {
      let url = `${videoUrlPrefix}${m[0]}/?p=${pid}`;
      wv.loadURL(url, {
        userAgent: userAgent.desktop
      });
      _history.replace(url);
      utils.log(`路由：选择分p，选中第${pid}，转跳地址：${url}`);
    }
  },
  goBangumiPart(ep) {
    utils.log(`路由：选择番剧分p`);
    _isLastNavigatePartSelect = true;
    _history.go(videoUrlPrefix + ep.bvid);
  },
  add: function(url) {
    // 丢掉当前位置往后的history
    _history.stack.length = _history.pos + 1;
    _history.stack.push(url);
    _history.pos++;
  },
  replace: function(url) {
    _history.stack[_history.stack.length - 1] = url;
  },
  pop: function() {
    _history.stack.pop();
    _history.pos--;
  },
  goBack: function() {
    if(!_history.canGoBack()) {
      return false;
    }
    utils.log('路由：后退');
    _history.go(_history.stack[--_history.pos], true);
  },
  goForward: function() {
    if(!_history.canGoForward()) {
      return false;
    }
    utils.log('路由：前进');
    _history.go(_history.stack[++_history.pos], true);
  },
  canGoBack: function() {
    return _history.pos > 0;
  },
  canGoForward: function() {
    return _history.pos + 1 < _history.stack.length;
  }
};

function getPartOfVideo(vid) {
  utils.ajax.get(videoUrlPrefix + vid, (res) => {
    // 用window.__INITIAL_STATE__=当标识，找到之后文本中包含的第一个完整json
    const index = res.indexOf('window.__INITIAL_STATE__=');
    const text = res.substr(index + 25);
    const json = utils.getFirstJsonFromString(text);
    if( !json ) {
      utils.log('获取视频分p数据失败', res);
      return false;
    }
    let parts;
    try {
      parts = json.videoData.pages;
    } catch(err) {
      utils.log(`解析视频分p失败：${err}`, json);
      return false;
    }
    utils.log(`获取视频 ${vid} 的分P数据成功`);
    if( parts.length ) {
      ipc.send('update-part', parts.map(p => p.part));
      // 有超过1p时自动开启分p窗口
      if( parts.length > 1 ) {
        ipc.send('show-select-part-window');
        v.disablePartButton = false;
      }
    } else {
      ipc.send('update-part', null);
      v.disablePartButton = true;
    }
  });
}

function getPartOfBangumi(url) {
  utils.ajax.get(url, (res) => {
    // 用window.__INITIAL_STATE__=当标识，找到之后文本中包含的第一个完整json
    const index = res.indexOf('window.__INITIAL_STATE__=');
    const text = res.substr(index + 25);
    const json = utils.getFirstJsonFromString(text);
    if( !json ) {
      utils.log('获取番剧分p数据失败', res);
      return false;
    }
    let parts;
    let currentPartId = 0;
    try {
      parts = json.epList;
      currentPartId = json.epInfo.i;
    } catch(err) {
      utils.log(`解析番剧分p失败：${err}`, json);
      return false;
    }
    utils.log(`获取番剧 ${url} 的分P数据成功`);
    if( parts.length ) {
      ipc.send('update-bangumi-part', {
        currentPartId,
        parts: parts.map(p => {
          return {
            epid: p.i,
            aid: p.aid,
            bvid: p.bvid,
            title: p.longTitle
          };
        })
      });
      if( parts.length > 1 ) {
        ipc.send('show-select-part-window');
        v.disablePartButton = false;
      }
    } else {
      ipc.send('update-part', null);
      v.disablePartButton = true;
    }
  });
}

// UI逻辑
const v = new Vue({
  el: '#wrapper',
  data: {
    version: remote.app.getVersion(),
    naviGotoTarget: '',
    naviGotoInputShow: false,
    naviCanGoBack: false,
    naviCanGoForward: false,
    showNaviGotoOverlay: false,
    showAboutOverlay: false,
    disableDanmakuButton: true,
    disablePartButton: true
  },
  methods: {
    // 后退
    naviBack: function() {
      _history.goBack();
    },
    // 前进
    naviForward: function() {
      _history.goForward();
    },
    // 回到首页
    naviGoHome: function() {
      _history.go('https://m.bilibili.com/index.html');
    },
    // 通过url或av号跳转
    naviGotoShow: function() {
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        let url = wv.getURL();
        if( url.indexOf("majsoul") > -1 ){
          this.naviGotoTarget = 'http://m.bilibili.com/index.html';
          this.naviGoto();
          this.naviGotoHide();
          return;
        }
        this.naviGotoTarget = '';
        this.naviGotoInputShow = true;
        this.showNaviGotoOverlay = true;
        document.getElementById('av-input').focus();
      }, 300);
    },
    // 双击回b站首页
    naviGotoHome: function() {
      clearTimeout(clickTimer);
      this.naviGotoTarget = utils.config.get(`homeUrl`);
      this.naviGoto();
      this.naviGotoHide();
    },
    // 雀魂
    naviGotoMajsoul: function() {
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        this.naviGotoTarget = 'e';
        this.naviGoto();
        this.naviGotoHide();
        if (utils.config.get('isResetBoundForMajsoul') === 1) {
          utils.log('重置雀魂窗口');
          setTimeout(() => {
            resizeMainWindow('majsoul');
          }, 300);
        }
      }, 300);
    },
    // 雀魂双击设置自定义大小
    setWinCustomSize: function() {
      clearTimeout(clickTimer);
      resizeMainWindow('majsoul');
    },
    // 全屏
    naviGotoFullScreen: function() {
      resizeMainWindow('full-screen');
    },
    naviGotoHide: function() {
      this.naviGotoInputShow = this.showNaviGotoOverlay = false;
    },
    naviGoto: function() {
      var target = this.naviGotoTarget;
      let lv;
      utils.log(`路由：手动输入地址 ${target}`);
      // 包含bilibili.com的字符串和纯数字是合法的跳转目标
      if (target.startsWith('e')) {
        target = "https://game.maj-soul.com/1/";
        _history.go(target, null, "d");
        this.naviGotoHide();
      } else if(target.startsWith('http') && target.indexOf('bilibili.com') > -1) {
        _history.go(target);
        this.naviGotoHide();
      } else if (lv = /^lv(\d+)$/.exec(target)) {
        // 直播
        _history.go(liveUrlPrefix + lv[1]);
        this.naviGotoHide();
      } else if(/^(\d+)$/.test(target)) {
        // 纯数字是av号
        _history.go(videoUrlPrefix + 'av' + target);
        this.naviGotoHide();
      } else if(/^(BV\w+)/.test(target)) {
        // BV号
        _history.go(videoUrlPrefix + target);
        this.naviGotoHide();
      } else {
        // not a valid input
        alert('你确定输入的是b站链接或者av号吗？');
      }
    },
    // 关于
    showAbout: function() {
      utils.log('主窗口：点击关于');
      this.showAboutOverlay = !this.showAboutOverlay;
      wrapper.classList.toggle('showAbout');
      topbar.classList.toggle('showAbout');
    },
    hideAbout: function() {
      this.showAboutOverlay = false;
      wrapper.classList.remove('showAbout');
      topbar.classList.remove('showAbout');
    },
    // 召唤选p窗口
    toggleSelectPartWindow: function() {
      if(this.disablePartButton) {
        return false;
      }
      utils.log('主窗口：点击P');
      ipc.send('toggle-select-part-window');
    },
    // 进入订阅
    showFeed() {
      utils.log('主窗口：点击订阅');
      _history.go('https://t.bilibili.com/?tab=8');
    },
    // 设置窗口
    toggleConfig: function() {
      utils.log('主窗口：点击设置');
      ipc.send('toggle-config-window');
    },
    // 关鸡 - 在osx下仅关闭当前窗口，在windows下直接退出整个程序
    turnOff: function() {
      utils.log('主窗口：点击退出');
      ipc.send('close-main-window');
    },
    // 显示、隐藏弹幕快捷键
    // pull request #1. Thanks to bumaociyuan
    toggleDanmaku: function() {
      if(this.disableDanmakuButton) {
        return false;
      }
      utils.log('主窗口：点击弹幕开关');
      // 2018-12-05 适配最新B站弹幕开关
      wv.executeJavaScript(`document.querySelector('.bilibili-player-video-danmaku-switch .bui-checkbox').click()`);
    }
  }
});

// 给body加上platform flag
function detectPlatform() {
  if(process.platform.startsWith('win')) {
    window.platform = 'win';
    document.body.classList.add('win');
  } else if(process.platform == 'darwin') {
    window.platform = 'darwin';
    document.body.classList.add('macos');
  }
}

// 检查更新
function checkUpdateOnInit() {
  if( _isLastestVersionChecked ) {
    return;
  } else {
    _isLastestVersionChecked = true;
  }
  utils.ajax.get('http://rakuen.thec.me/bilimini/beacon?_t=' + new Date().getTime(), (res) => {
    var data = JSON.parse(res),
      order = 1,
      buttons = ['取消', '去下载'];
    if(window.platform == 'win') {
      order = 0;
      buttons = ['去下载', '取消'];
    }
    // 提示更新
    var lastVersionArr = data.version.split('.'),
      lastVersion = lastVersionArr[0] * 10000 + lastVersionArr[1] * 100 + lastVersionArr[2],
      currentVersionArr = appData.version.split('.'),
      currentVersion = currentVersionArr[0] * 10000 + currentVersionArr[1] * 100 + currentVersionArr[2];
    if( lastVersion > currentVersion ) {
      dialog.showMessageBox(null, {
        buttons: buttons,
        message: `检查到新版本v${data.version}，您正在使用的版本是v${appData.version}，是否打开下载页面？`
      }, (res, checkboxChecked) => {
        if(res == order) {
          shell.openExternal(`https://pan.baidu.com/s/1jIHnRk6#list/path=%2Fbilimini%2Fv${data.version}`);
        }
      });
    }
    // 显示额外的公告
    if( data.announcement && data.announcement != '' && !localStorage.getItem(data.announcement) ) {
      dialog.showMessageBox(null, {
        buttons: ['了解'],
        message: data.announcement
      }, () => {
        localStorage.setItem(data.announcement, 1);
      });
    }
  });
}

// 当用户拖拽窗口时保存窗口尺寸
var saveWindowSizeTimer;
function saveWindowSizeOnResize() {
  window.addEventListener('resize', function() {
    clearTimeout(saveWindowSizeTimer);
    saveWindowSizeTimer = setTimeout(function() {
      let cw = remote.getCurrentWindow().getBounds();
      // win上双击topbar全屏之后位置变成-8,强制修改成0,避免下次打开的时候窗口位置偏移
      utils.config.set(currentWindowType + utils.constant.windowPositionKey,
          [cw.x === -8 ? 0 : cw.x, cw.y === -8 ? 0 : cw.y]);
      utils.config.set(currentWindowType, [window.innerWidth, window.innerHeight]);
      // 通知设置窗口改变位置
      ipc.send('main-window-resized', null, null);
    }, 600);
  });
}

// 根据用户访问的url决定app窗口尺寸
var currentWindowType = 'windowSizeDefault';

function resizeMainWindow(type) {
  let targetWindowType, url = wv.getURL();
  if( url.indexOf('/video/') > -1 || url.indexOf('html5player.html') > -1 ||
    /\/\/live\.bilibili\.com\/blanc\/\d+/.test(url) || url.indexOf('bangumi/play/') > -1 ) {
    targetWindowType = 'windowSizeMini';
  } else if( url.indexOf('majsoul') > -1){
    //雀魂修改窗口大小
    targetWindowType = 'windowSizeMajsoulDefault';
  } else if( url.indexOf('t.bilibili.com/?tab=8') > -1 ) {
    targetWindowType = 'windowSizeFeed';
  } else {
    targetWindowType = 'windowSizeDefault';
  }
  if( targetWindowType != currentWindowType || type !== undefined) {
    let mw = remote.getCurrentWindow(),
      currentSize = mw.getSize(),
      leftTopPosition = mw.getPosition(),
      rightBottomPosition = [leftTopPosition[0] + currentSize[0], leftTopPosition[1] + currentSize[1]],
      targetSize = utils.config.get(targetWindowType),
      targetPosition = utils.config.get(targetWindowType + utils.constant.windowPositionKey);
    utils.log(`目标窗口设置:${JSON.stringify(targetPosition)}`);
    if (targetPosition === undefined || targetPosition.size !== 2) {
      targetPosition = [rightBottomPosition[0] - targetSize[0], rightBottomPosition[1] - targetSize[1]];
    }
    
    // 以窗口右下角为基点变换尺寸，但是要保证左上角不会到屏幕外去
    targetPosition[0] = targetPosition[0] > 10 ? targetPosition[0] : 10;
    targetPosition[1] = targetPosition[1] > 10 ? targetPosition[1] : 10;

    let cw = remote.getCurrentWindow().getBounds();
    let options = {
      x: targetPosition[0],
      y: targetPosition[1],
      width: targetSize[0],
      height: targetSize[1]
    };
    if ('majsoul' === type) {
      options = {
        x: utils.config.get('majsoulWindowCustomPosition')[0],
        y: utils.config.get('majsoulWindowCustomPosition')[1],
        width: utils.config.get('majsoulWindowCustomSize')[0],
        height: utils.config.get('majsoulWindowCustomSize')[1]
      };
      // 清除全屏标识
      utils.config.delete(currentWindowType + utils.constant.isFullScreenKey);
    } else if (`full-screen` === type) {
      options = switchFullScreen(currentWindowType, `full-screen`);
    }
    switchFullScreen(targetWindowType);
    // win上双击topbar全屏之后位置变成-8,强制修改成0,避免下次打开的时候窗口位置偏移
    utils.config.set(currentWindowType + utils.constant.windowPositionKey,
        [cw.x === -8 ? 0 : cw.x, cw.y === -8 ? 0 : cw.y]);
    utils.config.set(currentWindowType, [window.innerWidth, window.innerHeight]);

    utils.log(`${targetWindowType}窗口设置:${JSON.stringify(options)}`);
    mw.setBounds(options, true);

    currentWindowType = targetWindowType;

    // 通知设置窗口改变位置
    ipc.send('main-window-resized', targetPosition, targetSize);
  }
}

// 切换全屏按钮
function switchFullScreen(targetWindowType, type) {
  let mw = remote.getCurrentWindow();
  let key = targetWindowType + utils.constant.windowBoundTempKey;
  let isEnableFullScreenKey = targetWindowType + utils.constant.isFullScreenKey;
  let isEnableFullScreen = utils.config.get(isEnableFullScreenKey);
  let fullScreenBtn = document.getElementById(`navi-full-screen`);
  let options;
  utils.log(`${targetWindowType}-${type}当前是否开启全屏:${isEnableFullScreen}`);
  if (type === undefined) {
    // 窗口类型切换的时候设置按钮样式
    fullScreenBtn.classList.remove('enable');
    if (isEnableFullScreen) {
      fullScreenBtn.classList.add(`enable`);
    } else {
      fullScreenBtn.classList.remove(`enable`);
    }
  } else {
    // 点击全屏按钮的时候修改缓存信息,并设置样式
    if (isEnableFullScreen) {
      // 已经是全屏,读取缓存的bound,还原成窗口,删除缓存信息,设置为false
      options = utils.config.get(key);
      utils.config.delete(key);
      utils.config.delete(isEnableFullScreenKey);
    } else {
      // 不是全屏,缓存当前bound,设置全屏,设置为true
      options = {
        x: 0,
        y: -1,
        width: window.screen.width,
        height: window.screen.height + 1
      };

      utils.config.set(key, mw.getBounds());
      utils.config.set(isEnableFullScreenKey, true);
    }

    return options;
  }
}

// 根据设置调整页面的透明度
function initSetBodyOpacity() {
  function update() {
    var opacity = utils.config.get('opacity');
    document.body.style.opacity = opacity;
  }
  ipc.on('set-opacity', update);
  update();
}

// webview跳转相关
function initActionOnWebviewNavigate() {
  // 判断是否能前进/后退
  wv.addEventListener('did-finish-load', function() {
    let url = wv.getURL();
    utils.log(`触发 did-finish-load 事件，当前url是: ${url}`);
    v.naviCanGoBack = _history.canGoBack();
    v.naviCanGoForward = _history.canGoForward();
    // 改变窗口尺寸
    resizeMainWindow();
    // 关闭loading遮罩
    wrapper.classList.remove('loading');
    // 根据跳转完成后的真实url决定如何抓取分p
    if( !_isLastNavigatePartSelect ) {
      const vid = utils.getVid(url);
      if( vid ) {
        getPartOfVideo(vid);
      } else if( url.indexOf('bangumi/play/') > -1 ) {
        getPartOfBangumi(url);
      }
    } else {
      _isLastNavigatePartSelect = false;
    }
  });
  wv.addEventListener('will-navigate', function(e) {
    if( e.url.startsWith('bilibili://') ) {
      utils.log(`网页端尝试拉起App: ${e.url}`);
      e.preventDefault();
      return false;
    } else {
      utils.log(`触发 will-navigate 事件，目标: ${e.url}`);
      _history.go(e.url);
    }
  });
  // webview中点击target="_blank"的链接时在当前webview打开
  wv.addEventListener('new-window', function(e) {
    utils.log(`触发 new-window 事件，目标: ${e.url}`);
    _history.go(e.url);
  });
}

// 无法正常打开页面时显示错误页面
// function displayErrorPageWhenLoadFail() {
//     wv.addEventListener('did-fail-load', () => {
//         wv.loadURL('file://' + __dirname + '/error.html');
//     });
// }

// 点击菜单「webview console」时打开webview
function openWebviewConsoleOnMenuClick() {
  ipc.on('openWebviewDevTools', () => {
    wv.openDevTools();
  });
}

// 收到选p消息时跳p
function redirectOnSelectPart() {
  ipc.on('select-part', (ev, pid) => {
    _history.goPart(pid);
  });
  ipc.on('select-bangumi-part', (ev, ep) => {
    _history.goBangumiPart(ep);
  });
}

// 按下ESC键
function initActionOnEsc() {
  ipc.on('press-esc', (ev) => {
    let url = wv.getURL();
    // 如果在播放页按下esc就触发后退
    if( utils.getVid(url) || url.indexOf('bangumi/play') > -1 || url.indexOf('majsoul') > -1) {
      utils.log('在播放器页面、雀魂按下ESC，后退至上一页');
      _history.goBack();
    }
  });
}

// 用户按↑、↓键时，把事件传递到webview里去实现修改音量功能
function initWebviewVolumeContrlShortcuts() {
  ipc.on('change-volume', (ev, arg) => {
    wv.send('change-volume', arg);
  });
}

// 用户enter时，把事件传递到webview里去实现修改播放器按enter快捷输入聚焦弹幕栏
function initWebviewSendEnterShortcuts() {
  ipc.on('focus-danmaku-input', (ev, arg) => {
    wv.focus();
    wv.send('focus-danmaku-input', arg);
  });
}

// 用户alt+enter时，全屏
function initFullScreenShortcuts() {
  ipc.on('enter-full-screen', (ev, arg) => {
    resizeMainWindow('full-screen');
  });
}

// windows下frameless window没法正确检测到mouseout事件，只能根据光标位置做个dirtyCheck了
function initMouseStateDirtyCheck() {
  // 统一改为由js判断，一旦鼠标进入主窗口的上较近才显示topbar
  var getMousePosition = remote.screen.getCursorScreenPoint,
    mw = remote.getCurrentWindow(), 
    lastStatus = 'OUT';
  setInterval(function() {
    let mousePos = getMousePosition(),
      windowPos = mw.getPosition(),
      windowSize = mw.getSize();
    // 在窗口最右边留出滚动条的宽度，用户操作滚动条时不会触发showTopbar；
    // 但是如果showTopbar已经触发，即用户已经在操作工具栏了，那么就暂时屏蔽这个规则
    function getTriggerAreaWidth() {
      return lastStatus == 'IN' ? 0 : 16;
    }
    // 如果topbar已经下来了，就主动把触发区域变高一点，防止鼠标稍微向下滑动就触发收起
    function getTriggerAreaHeight() {
      let h = 10;//0.1 * windowSize[1],
          minHeight = lastStatus == 'IN' ? 120 : 10;
      return h > minHeight ? h : minHeight;
    }
    if( (mousePos.x > windowPos[0]) && (mousePos.x < windowPos[0] + windowSize[0] - getTriggerAreaWidth()) &&
        (mousePos.y > windowPos[1]) && (mousePos.y < windowPos[1] + getTriggerAreaHeight()) ) {
      if( lastStatus == 'OUT' ) {
        //wrapper.classList.add('showTopBar');
        topbar.classList.add('showTopBar');
        lastStatus = 'IN';
      }
    } else if( lastStatus == 'IN' ) {
      lastStatus = 'OUT';
      //wrapper.classList.remove('showTopBar');
      topbar.classList.remove('showTopBar');
    }
  }, 200);
}

// 外链
function openExternalLink(url) {
  shell.openExternal(url);
}

// 把webview里的报错信息log下来
function logWebviewError() {
  wv.addEventListener('console-message', (err) => {
    // 我看console.error的level是2，那>1的就都log下来吧
    if(err.level > 1) {
      utils.error(`Webview报错\nLine ${err.line}: ${err.message}\nwebview当前url: ${wv.getURL()}`)
    }
  });
}

window.addEventListener('DOMContentLoaded', function() {

  wrapper = document.getElementById('wrapper');
  topbar = document.getElementById('topbar');
  wv = document.getElementById('wv');
  detectPlatform();
  checkUpdateOnInit();
  initActionOnWebviewNavigate();
  initActionOnEsc();
  initWebviewVolumeContrlShortcuts();
  initWebviewSendEnterShortcuts();
  initFullScreenShortcuts();
  saveWindowSizeOnResize();
  initMouseStateDirtyCheck();
  openWebviewConsoleOnMenuClick();
  redirectOnSelectPart();
  initSetBodyOpacity();
  logWebviewError();
});

window.onerror = function(err, f, line) {
  var id = f.split('/');
  utils.error(`${id[id.length-1]} : Line ${line}\n> ${err}`);
}
