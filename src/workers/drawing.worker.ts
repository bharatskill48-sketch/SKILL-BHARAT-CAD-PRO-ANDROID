import { DxfViewer } from "dxf-viewer";
import { DxfScene } from "dxf-viewer/src/DxfScene.js";
import { installSavedLayerVisibility } from "../viewer/savedLayerVisibility";
import { installXclipScenePreparation } from "../viewer/xclipScene";
import { installMeasurementPreparation } from "../viewer/measurementGeometry";

installSavedLayerVisibility(DxfScene);
installXclipScenePreparation(DxfScene);
installMeasurementPreparation(DxfScene);
DxfViewer.SetupWorker();
