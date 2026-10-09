import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  AppError,
  type LoadingPhase,
  type ViewerCommand,
  type ViewerHandle,
} from "../types/drawing";
import { DrawingViewer } from "../viewer/DrawingViewer";

type Props = {
  file: File;
  onProgress(
    phase: LoadingPhase,
    processed: number,
    total: number,
  ): void;
  onReady(): void;
  onError(error: unknown): void;
};

export const DrawingCanvas = forwardRef<ViewerHandle, Props>(
  function DrawingCanvas({ file, onProgress, onReady, onError }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<DrawingViewer | null>(null);
    const callbacksRef = useRef({ onProgress, onReady, onError });
    callbacksRef.current = { onProgress, onReady, onError };

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
        });
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

    return <div ref={containerRef} className="drawing-canvas" />;
  },
);

