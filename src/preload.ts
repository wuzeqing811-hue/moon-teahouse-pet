import { contextBridge, ipcRenderer } from 'electron';
import type { PetAPI } from './shared/contracts';

function listen<T>(channel: string, callback: (value: T) => void) {
  const handler = (_: Electron.IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const petAPI: PetAPI = {
  pet: {
    getState: () => ipcRenderer.invoke('pet:state'), onState: callback => listen('pet:update', callback),
    input: input => ipcRenderer.send('pet:input', input), wheel: delta => ipcRenderer.send('pet:wheel', delta),
    ready: (assetRevision, pixels) => ipcRenderer.send('pet:ready', assetRevision, pixels),
    poseMask: (revision, pixels) => ipcRenderer.send('pet:pose-mask', revision, pixels),
    ended: revision => ipcRenderer.send('pet:ended', revision),
    saveClip: (revision, action, clip) => ipcRenderer.invoke('pet:save-clip', revision, action, clip),
    hide: () => ipcRenderer.invoke('pet:hide'), show: () => ipcRenderer.invoke('pet:show'),
    setSize: size => ipcRenderer.invoke('pet:size', size), getSize: () => ipcRenderer.invoke('pet:get-size'), getOutfits: () => ipcRenderer.invoke('pet:list'),
    selectOutfit: id => ipcRenderer.invoke('pet:select', id), importOutfit: () => ipcRenderer.invoke('pet:import'),
    reloadOutfits: () => ipcRenderer.invoke('pet:reload'),
  },
  chat: {
    resize: size => ipcRenderer.invoke('chat:resize', size),
    getState: () => ipcRenderer.invoke('chat:state'), send: request => ipcRenderer.invoke('chat:send', request),
    cancel: id => ipcRenderer.invoke('chat:cancel', id), onChunk: callback => listen('chat:chunk', callback),
    onOutfit: callback => listen('chat:outfit', callback), onPanel: callback => listen('chat:panel', callback),
    onModel: callback => listen('chat:model', callback),
    hide: () => ipcRenderer.invoke('chat:hide'), openSource: url => ipcRenderer.invoke('chat:source', url),
    history: characterId => ipcRenderer.invoke('chat:history', characterId),
  },
  settings: { save: update => ipcRenderer.invoke('settings:save', update), checkModel: retry => ipcRenderer.invoke('settings:model', retry),
    testDeepSeek: () => ipcRenderer.invoke('settings:deepseek-test') },
  search: { query: query => ipcRenderer.invoke('search:query', query) },
  wardrobe: { open: () => ipcRenderer.invoke('wardrobe:open'), getState: () => ipcRenderer.invoke('wardrobe:state'),
    apply: (characterId, look) => ipcRenderer.invoke('wardrobe:apply', characterId, look),
    preset: characterId => ipcRenderer.invoke('wardrobe:preset', characterId), close: () => ipcRenderer.send('wardrobe:close') },
};
contextBridge.exposeInMainWorld('petAPI', petAPI);
