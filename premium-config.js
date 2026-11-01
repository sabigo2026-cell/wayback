// WakaBack Premium settings.
// Fill these in after creating the Firebase project and RevenueCat app (see PREMIUM-SETUP.md).
// While "firebase" is null, the app works as before and Premium shows "coming soon".
window.WAKA_CONFIG = {
  firebase: null,
  // firebase: {
  //   apiKey: "…",
  //   authDomain: "…firebaseapp.com",
  //   projectId: "…",
  //   storageBucket: "…firebasestorage.app",
  //   messagingSenderId: "…",
  //   appId: "…"
  // },
  revenuecat: { android: "", ios: "" },   // RevenueCat public SDK keys (goog_… and appl_…)
  entitlement: "premium",                  // RevenueCat entitlement name
  liveUrl: "https://sabigo2026-cell.github.io/wayback/live.html"
};
