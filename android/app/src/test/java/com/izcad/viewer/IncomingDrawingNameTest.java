package com.izcad.viewer;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class IncomingDrawingNameTest {

    @Test
    public void preservesTheDrawingExtensionInsteadOfTrustingAMisleadingMimeType() {
        assertEquals("Plan.DXF", IncomingDrawingPlugin.normalizeDrawingName("Plan.DXF", null, "image/vnd.dwg"));
    }

    @Test
    public void replacesUnsafeProviderNameCharacters() {
        assertEquals("folder_plan_.dxf", IncomingDrawingPlugin.normalizeDrawingName("folder/plan\u0000.dxf", null, "application/dxf"));
    }

    @Test
    public void infersKnownCadExtensionsWhenAProviderOmitsTheName() {
        assertEquals("drawing.dwg", IncomingDrawingPlugin.normalizeDrawingName(null, null, "application/acad"));
        assertEquals("123.dxf", IncomingDrawingPlugin.normalizeDrawingName("  ", "123", "application/x-dxf"));
    }

    @Test
    public void keepsUnknownBinaryFilesForWebValidationInsteadOfInventingCadExtensions() {
        assertEquals("notes.txt", IncomingDrawingPlugin.normalizeDrawingName("notes.txt", null, "application/octet-stream"));
    }

    @Test
    public void boundsProviderNamesToTheLibraryLimitAfterExtensionInference() {
        String name = IncomingDrawingPlugin.normalizeDrawingName("x".repeat(1000) + ".dwg", null, null);
        assertEquals(220, name.length());
        assertTrue(name.endsWith(".dwg"));
        String inferred = IncomingDrawingPlugin.normalizeDrawingName("x".repeat(1000), null, "application/dxf");
        assertEquals(220, inferred.length());
        assertTrue(inferred.endsWith(".dxf"));
    }
}
