
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.skillbharat.cadpro",
  appName: "SKILL BHARAT CAD PRO",
  webDir: "dist",
  plugins: {
    SystemBars: {
      style: "DARK",
      hidden: false,
      insetsHandling: "css",
    },
  },
  android: {
    minWebViewVersion: 64,
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
