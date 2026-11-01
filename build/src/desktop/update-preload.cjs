'use strict';
// 업데이트 다운로드 진행창 전용 preload — 취소 신호만 메인 프로세스로 보낸다.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gsUpdate', { cancel: () => ipcRenderer.send('gs-update-cancel') });
