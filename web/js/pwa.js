/** Browser-only PWA lifecycle helpers. No document bytes are stored or transmitted here. */
export function createPwaLifecycle({
  onConnectivityChange = () => {},
  onInstallAvailable = () => {},
  onUpdateAvailable = () => {},
  onStatus = () => {},
} = {}) {
  let installPrompt;
  let registration;
  let updateRequested = false;
  let started = false;

  function reportConnectivity() {
    onConnectivityChange(globalThis.navigator?.onLine !== false);
  }

  function reportWaitingWorker() {
    if (registration?.waiting) onUpdateAvailable(applyUpdate);
  }

  function watchInstallingWorker(worker) {
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && globalThis.navigator.serviceWorker.controller) {
        reportWaitingWorker();
      }
    });
  }

  async function start() {
    if (started) return registration;
    started = true;
    reportConnectivity();
    globalThis.addEventListener("online", reportConnectivity);
    globalThis.addEventListener("offline", reportConnectivity);
    globalThis.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      installPrompt = event;
      onInstallAvailable(true);
    });
    globalThis.addEventListener("appinstalled", () => {
      installPrompt = undefined;
      onInstallAvailable(false);
      onStatus("ModiPDFy was installed on this device.", "ready");
    });

    if (!("serviceWorker" in navigator)) {
      onStatus("Offline caching is unavailable in this browser.", "warning");
      return null;
    }

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (updateRequested) globalThis.location.reload();
    });

    try {
      registration = await navigator.serviceWorker.register(new URL("../sw.js", import.meta.url), {
        scope: new URL("../", import.meta.url).pathname,
        updateViaCache: "none",
      });
      registration.addEventListener("updatefound", () => {
        if (registration.installing) watchInstallingWorker(registration.installing);
      });
      if (registration.installing) watchInstallingWorker(registration.installing);
      reportWaitingWorker();
      return registration;
    } catch {
      onStatus("Offline caching could not be enabled in this browser.", "warning");
      return null;
    }
  }

  async function install() {
    if (!installPrompt) return false;
    const prompt = installPrompt;
    installPrompt = undefined;
    onInstallAvailable(false);
    await prompt.prompt();
    const choice = await prompt.userChoice;
    return choice?.outcome === "accepted";
  }

  function applyUpdate() {
    if (!registration?.waiting) return false;
    updateRequested = true;
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
    return true;
  }

  return { start, install, applyUpdate };
}
