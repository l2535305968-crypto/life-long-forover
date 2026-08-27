import { onRequestPost as __api_asr_js_onRequestPost } from "D:\\life-long-forover\\functions\\api\\asr.js"
import { onRequestPost as __api_chat_js_onRequestPost } from "D:\\life-long-forover\\functions\\api\\chat.js"
import { onRequestGet as __api_health_js_onRequestGet } from "D:\\life-long-forover\\functions\\api\\health.js"
import { onRequestPost as __api_tts_js_onRequestPost } from "D:\\life-long-forover\\functions\\api\\tts.js"

export const routes = [
    {
      routePath: "/api/asr",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_asr_js_onRequestPost],
    },
  {
      routePath: "/api/chat",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_chat_js_onRequestPost],
    },
  {
      routePath: "/api/health",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_health_js_onRequestGet],
    },
  {
      routePath: "/api/tts",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_tts_js_onRequestPost],
    },
  ]