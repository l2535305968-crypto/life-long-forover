// index.mjs — 《人生之书》SDK 入口。零依赖 ESM。
//
// 浏览器：
//   import { SdkClient, Conversation } from './sdk/js/index.mjs';
//   const client = new SdkClient();            // 同源，直接用当前服务的 /api/v1
//   const client2 = new SdkClient('http://192.168.1.5:8788');
//
// Node：
//   import { SdkClient } from './sdk/js/index.mjs';
//   const client = new SdkClient('http://localhost:8788');

export { SdkClient, SdkError } from './client.mjs';
export {
  newSession, addTurn, addImage, removeImage, addLog,
  stripForWire, mergeSession,
  lastAiTurn, lastElderTurn,
  Conversation
} from './session.mjs';
export { encryptText, decryptText, exportBook, importBook } from './crypto.mjs';
