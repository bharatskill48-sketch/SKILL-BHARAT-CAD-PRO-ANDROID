package com.izcad.viewer;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Parcelable;
import android.os.CancellationSignal;
import android.provider.OpenableColumns;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.Nullable;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

@CapacitorPlugin(name = "IncomingDrawing")
public class IncomingDrawingPlugin extends Plugin {

    private final Object pendingLock = new Object();
    private JSObject pendingDrawing;
    private final ExecutorService metadataExecutor = Executors.newSingleThreadExecutor();
    private CancellationSignal metadataCancellation;
    private volatile boolean destroyed;
    private long intentGeneration;

    @Override
    public void load() {
        getActivity().getOnBackPressedDispatcher().addCallback(
            getActivity(),
            new OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
                    if (hasListeners("backPressed")) {
                        notifyListeners("backPressed", new JSObject());
                    } else {
                        // Back remains usable while the web application starts or fails.
                        getActivity().finish();
                    }
                }
            }
        );
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        Uri uri = getDrawingUri(intent);
        if (uri == null || !isLocalUri(uri)) {
            return;
        }

        if (metadataCancellation != null) {
            metadataCancellation.cancel();
        }
        final CancellationSignal cancellation = new CancellationSignal();
        metadataCancellation = cancellation;
        final long generation = ++intentGeneration;
        synchronized (pendingLock) {
            pendingDrawing = null;
        }
        final String intentMimeType = intent.getType();
        final ContentResolver resolver = getContext().getContentResolver();

        // A file provider can be slow. Never query it on Android's UI thread.
        metadataExecutor.execute(() -> {
            if (destroyed || cancellation.isCanceled()) {
                return;
            }
            String mimeType = intentMimeType;
            if (mimeType == null || mimeType.trim().isEmpty()) {
                try {
                    mimeType = resolver.getType(uri);
                } catch (RuntimeException ignored) {
                    mimeType = null;
                }
            }
            DrawingMetadata metadata = readMetadata(resolver, uri, cancellation);
            if (destroyed || cancellation.isCanceled()) {
                return;
            }
            final JSObject drawing = new JSObject();
            drawing.put("id", UUID.randomUUID().toString());
            drawing.put("uri", uri.toString());
            drawing.put("name", normalizeDrawingName(metadata.name, uri.getLastPathSegment(), mimeType));
            drawing.put("mimeType", mimeType == null ? "" : mimeType);
            drawing.put("size", metadata.size);
            getActivity().runOnUiThread(() -> {
                if (destroyed || generation != intentGeneration) {
                    return;
                }
                synchronized (pendingLock) {
                    pendingDrawing = drawing;
                }
                notifyListeners("drawingReceived", drawing, true);
            });
        });
    }

    @PluginMethod
    public void getPendingDrawing(PluginCall call) {
        JSObject result = new JSObject();
        synchronized (pendingLock) {
            result.put(
                "drawing",
                pendingDrawing == null ? JSONObject.NULL : pendingDrawing
            );
        }
        call.resolve(result);
    }

    @PluginMethod
    public void acknowledgeDrawing(PluginCall call) {
        final String id = call.getString("id");
        getActivity().runOnUiThread(() -> {
            boolean acknowledged = false;
            synchronized (pendingLock) {
                if (
                    pendingDrawing != null &&
                    id != null &&
                    id.equals(pendingDrawing.getString("id"))
                ) {
                    pendingDrawing = null;
                    acknowledged = true;
                    // The web application has read the incoming file. Do not
                    // reopen the launch intent after a later activity recreation.
                    getActivity().setIntent(
                        new Intent(getContext(), MainActivity.class).setAction(Intent.ACTION_MAIN)
                    );
                }
            }
            JSObject result = new JSObject();
            result.put("acknowledged", acknowledged);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void exitApp(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            call.resolve();
            getActivity().finish();
        });
    }

    @Override
    protected void handleOnResume() {
        JSObject state = new JSObject();
        state.put("isActive", true);
        notifyListeners("appStateChange", state);
    }

    @Override
    protected void handleOnPause() {
        JSObject state = new JSObject();
        state.put("isActive", false);
        notifyListeners("appStateChange", state);
    }

    @Override
    protected void handleOnDestroy() {
        destroyed = true;
        if (metadataCancellation != null) {
            metadataCancellation.cancel();
        }
        metadataExecutor.shutdownNow();
        synchronized (pendingLock) {
            pendingDrawing = null;
        }
    }

    @Nullable
    private Uri getDrawingUri(Intent intent) {
        if (intent == null) {
            return null;
        }

        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action)) {
            Uri data = intent.getData();
            return data == null ? getFirstClipDataUri(intent) : data;
        }

        if (!Intent.ACTION_SEND.equals(action)) {
            return null;
        }

        Parcelable stream;
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            stream = intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        } else {
            stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        }
        if (stream instanceof Uri) {
            return (Uri) stream;
        }

        return getFirstClipDataUri(intent);
    }

    @Nullable
    private Uri getFirstClipDataUri(Intent intent) {
        ClipData clipData = intent.getClipData();
        if (clipData != null && clipData.getItemCount() > 0) {
            return clipData.getItemAt(0).getUri();
        }

        return null;
    }

    private boolean isLocalUri(Uri uri) {
        String scheme = uri.getScheme();
        return ContentResolver.SCHEME_CONTENT.equals(scheme) ||
        ContentResolver.SCHEME_FILE.equals(scheme);
    }

    private DrawingMetadata readMetadata(
        ContentResolver resolver,
        Uri uri,
        CancellationSignal cancellation
    ) {
        String name = null;
        long size = -1;

        try (
            Cursor cursor = resolver.query(
                uri,
                new String[] {
                    OpenableColumns.DISPLAY_NAME,
                    OpenableColumns.SIZE,
                },
                null,
                null,
                null,
                cancellation
            )
        ) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameColumn = cursor.getColumnIndex(
                    OpenableColumns.DISPLAY_NAME
                );
                int sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE);

                if (nameColumn >= 0 && !cursor.isNull(nameColumn)) {
                    name = cursor.getString(nameColumn);
                }
                if (sizeColumn >= 0 && !cursor.isNull(sizeColumn)) {
                    size = Math.max(-1, cursor.getLong(sizeColumn));
                }
            }
        } catch (RuntimeException ignored) {
            // Metadata is optional; the granted URI can still be opened.
        }

        return new DrawingMetadata(name, size);
    }

    static String normalizeDrawingName(
        @Nullable String displayName,
        @Nullable String lastPathSegment,
        @Nullable String mimeType
    ) {
        String name = displayName;
        if (name == null || name.trim().isEmpty()) {
            name = lastPathSegment;
        }
        if (name == null || name.trim().isEmpty()) {
            name = "drawing";
        }

        name = name.replaceAll("[\\\\/\\p{Cntrl}]", "_").trim();
        if (name.isEmpty()) {
            name = "drawing";
        }

        if (!hasSupportedFileExtension(name)) {
            String inferredExtension = extensionForMimeType(mimeType);
            if (inferredExtension != null) {
                name += inferredExtension;
            }
        }

        // Providers may expose arbitrary names. Match the web library's limit
        // after extension inference so every incoming drawing can be imported.
        if (name.length() > 220) {
            int extensionStart = name.lastIndexOf('.');
            String extension = extensionStart >= 0 ? name.substring(extensionStart) : "";
            if (extension.length() > 12) {
                extension = "";
            }
            name = name.substring(0, 220 - extension.length()) + extension;
        }

        return name;
    }

    private static boolean hasSupportedFileExtension(String name) {
        String lowerName = name.toLowerCase(Locale.ROOT);
        return lowerName.endsWith(".dxf") || lowerName.endsWith(".dwg") ||
            lowerName.endsWith(".pdf") || lowerName.endsWith(".zip") || lowerName.endsWith(".rar");
    }

    @Nullable
    private static String extensionForMimeType(@Nullable String mimeType) {
        if (mimeType == null) {
            return null;
        }

        String normalized = mimeType.toLowerCase(Locale.ROOT).split(";", 2)[0].trim();
        if (normalized.equals("application/pdf")) {
            return ".pdf";
        }
        if (normalized.equals("application/zip") || normalized.equals("application/x-zip-compressed")) {
            return ".zip";
        }
        if (normalized.equals("application/vnd.rar") || normalized.equals("application/x-rar-compressed") ||
            normalized.equals("application/x-rar")) {
            return ".rar";
        }
        if (normalized.contains("dxf")) {
            return ".dxf";
        }
        if (
            normalized.contains("dwg") ||
            normalized.contains("acad") ||
            normalized.contains("autocad")
        ) {
            return ".dwg";
        }
        return null;
    }

    private static final class DrawingMetadata {

        @Nullable
        private final String name;
        private final long size;

        private DrawingMetadata(@Nullable String name, long size) {
            this.name = name;
            this.size = size;
        }
    }
}
