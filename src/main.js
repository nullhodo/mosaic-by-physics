import {
  getIsCurrentlyRecording,
  startCanvasVideoRecording,
  stopCanvasVideoRecording,
} from "./exporter.js";
import { setP5SketchInstance, sketchDefinition } from "./sketch.js";
import {
  setStateApplier,
  setToastNotifier,
  triggerRedoOperation,
  triggerUndoOperation,
} from "./state.js";
import {
  applyStateFromJsonObject,
  displayToastNotification,
  setupUIEventListeners,
  toggleUserInterfaceDrawer,
} from "./ui.js";

window.addEventListener("DOMContentLoaded", () => {
  setStateApplier(applyStateFromJsonObject);
  setToastNotifier(displayToastNotification);

  const p5SketchInstance = new p5(sketchDefinition);
  setP5SketchInstance(p5SketchInstance);

  setupUIEventListeners();

  window.addEventListener("keydown", (event) => {
    if (event.key === "r" || event.key === "R") {
      if (!getIsCurrentlyRecording()) startCanvasVideoRecording();
    } else if (event.key === "s" || event.key === "S") {
      if (getIsCurrentlyRecording()) stopCanvasVideoRecording();
    } else if (event.key === "h" || event.key === "H") {
      toggleUserInterfaceDrawer();
    } else if (
      (event.ctrlKey || event.metaKey) &&
      (event.key === "z" || event.key === "Z")
    ) {
      if (event.shiftKey) {
        triggerRedoOperation();
      } else {
        triggerUndoOperation();
      }
    }
  });
});
