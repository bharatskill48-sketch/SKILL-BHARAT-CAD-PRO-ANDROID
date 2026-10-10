import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  AppError,
  type LoadingPhase,
  type ViewerCommand,
  type ViewerHandle,
} from "../types/drawing";
import { DrawingViewer, type MeasurementPick } from "../viewer/DrawingViewer";
import type { MeasurementGeometry, MeasurementSettings } from "../viewer/measurementGeometry";
import type { DrawingPoint } from "../viewer/savedView";

type Props = {
  file: File;
  onProgress(
    phase: LoadingPhase,
    processed: number,
    total: number,
  ): void;
  onReady(): void;
  onError(error: unknown): void;
  measurement: MeasurementSettings;
  onMeasurementPick(pick: MeasurementPick): void;
  onMeasurementReady(geometry: MeasurementGeometry): void;
};

export const DrawingCanvas = forwardRef<ViewerHandle, Props>(
  function DrawingCanvas({ file, onProgress, onReady, onError, measurement, onMeasurementPick, onMeasurementReady }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<DrawingViewer | null>(null);
    const callbacksRef = useRef({ onProgress, onReady, onError, onMeasurementPick, onMeasurementReady });
    callbacksRef.current = { onProgress, onReady, onError, onMeasurementPick, onMeasurementReady };
    const measurementRef = useRef(measurement);
    measurementRef.current = measurement;
    const [projected, setProjected] = useState<DrawingPoint[]>([]);
    const updateProjection = () => {
      const settings = measurementRef.current;
      if (!viewerRef.current || !settings.enabled) { setProjected([]); return; }
      setProjected(viewerRef.current.projectPoints(settings.mode === "object" ? settings.entity?.points ?? [] : settings.points));
    };

    useEffect(() => {
      viewerRef.current?.configureMeasurement(measurement);
      updateProjection();
    }, [measurement]);

    useImperativeHandle(
      ref,
      () => ({
        execute(command: ViewerCommand) {
          try {
            viewerRef.current?.execute(command);
          } catch (error) {
            callbacksRef.current.onError(
              error instanceof AppError
                ? error
                : new AppError("RENDER_FAILED", undefined, { cause: error }),
            );
          }
        },
      }),
      [],
    );

    useEffect(() => {
      if (!containerRef.current) {
        return;
      }

      let active = true;
      let viewer: DrawingViewer;
      try {
        viewer = new DrawingViewer(containerRef.current, (error) => {
          if (active) {
            callbacksRef.current.onError(error);
          }
        }, (pick) => { if (active) callbacksRef.current.onMeasurementPick(pick); }, () => { if (active) updateProjection(); });
      } catch (error) {
        callbacksRef.current.onError(error);
        return;
      }
      viewerRef.current = viewer;

      viewer
        .load(file, (phase, processed, total) => {
          if (active) {
            callbacksRef.current.onProgress(phase, processed, total);
          }
        })
        .then(() => {
          if (active) {
            viewer.configureMeasurement(measurementRef.current);
            callbacksRef.current.onMeasurementReady(viewer.getMeasurementGeometry());
            callbacksRef.current.onReady();
          }
        })
        .catch((error: unknown) => {
          if (active) {
            callbacksRef.current.onError(error);
          }
        });

      return () => {
        active = false;
        viewerRef.current = null;
        viewer.destroy();
      };
    }, [file]);

    return (
      <div className={`drawing-canvas ${measurement.enabled ? "measurement-active" : ""}`}>
        <div ref={containerRef} className="drawing-surface" />
        {measurement.enabled && projected.length > 0 ? (
          <svg className="measurement-overlay" aria-hidden="true">
            {measurement.mode === "area" && projected.length >= 3 ? <polygon points={projected.map((p) => `${p.x},${p.y}`).join(" ")} /> :
              <polyline points={projected.map((p) => `${p.x},${p.y}`).join(" ")} />}
            {measurement.mode !== "object" ? projected.map((p, i) => (
              <g key={i}><circle cx={p.x} cy={p.y} r="5" /><text x={p.x + 11} y={p.y - 11}>{i + 1}</text></g>
            )) : null}
          </svg>
        ) : null}
      </div>
    );
  },
);

