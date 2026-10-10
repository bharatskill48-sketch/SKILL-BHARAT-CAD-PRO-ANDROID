import { useI18n } from "../i18n/I18nProvider";
import { CloseIcon } from "./Icons";
import {
  convertMeasurement, measuredAngle, pathLength, polygonArea,
  type MeasurementGeometry, type MeasurementMode, type MeasurementSettings, type MeasurementUnit,
} from "../viewer/measurementGeometry";

type Props = {
  settings: MeasurementSettings;
  geometry: MeasurementGeometry | null;
  sourceUnit: MeasurementUnit;
  displayUnit: MeasurementUnit;
  feedback: string | null;
  onSettings(settings: MeasurementSettings): void;
  onSourceUnit(unit: MeasurementUnit): void;
  onDisplayUnit(unit: MeasurementUnit): void;
};
const unitOptions: MeasurementUnit[] = ["drawing", "mm", "cm", "m", "in", "ft"];

export function MeasurementPanel({ settings, geometry, sourceUnit, displayUnit, feedback, onSettings, onSourceUnit, onDisplayUnit }: Props) {
  const { t, locale } = useI18n();
  const format = (value: number, area = false) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(convertMeasurement(value, sourceUnit, displayUnit, area))} ${displayUnit === "drawing" ? t("drawingUnit") : displayUnit}${area ? "²" : ""}`;
  const value = settings.mode === "object" ? settings.entity?.length : settings.mode === "area" ? (settings.points.length >= 3 ? polygonArea(settings.points) : undefined) : settings.mode === "angle" ? measuredAngle(settings.points) ?? undefined : settings.points.length >= 2 ? pathLength(settings.points) : undefined;
  const instruction = settings.mode === "object" ? t("measurePickObject") : settings.mode === "angle" ? t("measurePickAngle") : settings.mode === "area" ? t("measurePickArea") : settings.mode === "path" ? t("measurePickPath") : t("measurePickDistance");
  return (
    <section className="measurement-panel" aria-label={t("measure")}>
      <div className="measurement-title"><strong>{t("measure")}</strong><button type="button" className="icon-button" aria-label={t("closeMeasurement")} onClick={() => onSettings({ ...settings, enabled: false })}><CloseIcon /></button></div>
      <div className="measurement-modes">
        {(["distance", "path", "area", "angle", "object"] as MeasurementMode[]).map((mode) => (
          <button key={mode} type="button" aria-pressed={settings.mode === mode} onClick={() => onSettings({ ...settings, mode, points: [], entity: null })}>{t(({ distance: "measureDistance", path: "measurePath", area: "measureArea", angle: "measureAngle", object: "measureObject" } as const)[mode])}</button>
        ))}
      </div>
      <div className="measurement-result" role="status">
        <strong>{value === undefined ? "—" : `${settings.entity?.approximate && settings.mode === "object" ? "≈ " : ""}${settings.mode === "angle" ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)}°` : format(value, settings.mode === "area")}`}</strong>
        {settings.mode === "area" && settings.points.length >= 3 ? <span>{t("measurePerimeter")}: {format(pathLength(settings.points, true))}</span> : null}
        {settings.mode === "object" && settings.entity?.area !== undefined ? <span>{t("measureArea")}: {format(settings.entity.area, true)}</span> : null}
      </div>
      <p className="measurement-instruction">{instruction}</p>
      <div className="measurement-options">
        <label>{t("drawingUnitLabel")}<select value={sourceUnit} onChange={(e) => { const unit = e.target.value as MeasurementUnit; onSourceUnit(unit); if (displayUnit === "drawing") onDisplayUnit(unit); }}>{unitOptions.map((unit) => <option key={unit} value={unit}>{unit === "drawing" ? t("drawingUnit") : unit}</option>)}</select></label>
        <label>{t("displayUnitLabel")}<select value={displayUnit} onChange={(e) => onDisplayUnit(e.target.value as MeasurementUnit)}>{unitOptions.filter((unit) => sourceUnit !== "drawing" || unit === "drawing").map((unit) => <option key={unit} value={unit}>{unit === "drawing" ? t("drawingUnit") : unit}</option>)}</select></label>
        <label className="measurement-snap"><input type="checkbox" checked={settings.snapping} onChange={(e) => onSettings({ ...settings, snapping: e.target.checked })} />{t("measureSnap")}</label>
      </div>
      {sourceUnit === "drawing" ? <p className="measurement-hint">{t("measureUnknownUnit")}</p> : null}
      {geometry?.limited ? <p className="measurement-hint">{t("measureIndexLimited")}</p> : null}
      <div className="measurement-actions">
        <span className="measurement-feedback" role="status">{feedback ?? t("measure2D")}</span>
        <button type="button" disabled={settings.points.length === 0 && !settings.entity} onClick={() => onSettings({ ...settings, points: settings.points.slice(0, -1), entity: null })}>{t("measureUndo")}</button>
        <button type="button" disabled={settings.points.length === 0 && !settings.entity} onClick={() => onSettings({ ...settings, points: [], entity: null })}>{t("measureClear")}</button>
      </div>
    </section>
  );
}
