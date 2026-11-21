import { useLocale } from "@calcom/lib/hooks/useLocale";
import type { LookBusyPolicy } from "@calcom/prisma/lookBusySchema";
import { useId } from "react";

const inputClass =
  "border-default bg-default text-emphasis mt-2 block w-full rounded-md border px-3 py-2 text-sm";

export function LookBusySettings({
  value = { mode: "off" },
  onChange,
}: {
  value?: LookBusyPolicy;
  onChange: (value: LookBusyPolicy) => void;
}) {
  const { t } = useLocale();
  const id = useId();
  return (
    <fieldset className="border-subtle mt-6 rounded-lg border p-6">
      <legend className="text-emphasis px-1 text-sm font-semibold">{t("look_busy_title")}</legend>
      <p className="text-subtle mb-4 text-sm">{t("look_busy_description")}</p>
      <label className="text-emphasis text-sm font-medium" htmlFor={`${id}-mode`}>
        {t("look_busy_mode")}
      </label>
      <select
        id={`${id}-mode`}
        className={inputClass}
        value={value.mode}
        onChange={(event) => {
          const mode = event.target.value;
          if (mode === "day" || mode === "week")
            onChange({ mode, count: "count" in value ? value.count : mode === "day" ? 4 : 10 });
          else if (mode === "percentage") onChange({ mode, percentage: 33 });
          else onChange({ mode: "off" });
        }}>
        <option value="off">{t("look_busy_off")}</option>
        <option value="day">{t("look_busy_day")}</option>
        <option value="week">{t("look_busy_week")}</option>
        <option value="percentage">{t("look_busy_percentage_mode")}</option>
      </select>
      {(value.mode === "day" || value.mode === "week") && (
        <div className="mt-4">
          <label className="text-emphasis text-sm font-medium" htmlFor={`${id}-count`}>
            {t("look_busy_count")}
          </label>
          <input
            id={`${id}-count`}
            type="number"
            min={1}
            max={1000}
            step={1}
            required
            className={inputClass}
            value={Number.isNaN(value.count) ? "" : value.count}
            onChange={(event) => onChange({ ...value, count: event.target.valueAsNumber })}
            aria-describedby={`${id}-help`}
          />
          <p id={`${id}-help`} className="text-subtle mt-2 text-sm">
            {t(value.mode === "week" ? "look_busy_week_help" : "look_busy_day_help")}
          </p>
        </div>
      )}
      {value.mode === "percentage" && (
        <div className="mt-4">
          <label className="text-emphasis text-sm font-medium" htmlFor={`${id}-percentage`}>
            {t("look_busy_percentage")}
          </label>
          <select
            id={`${id}-percentage`}
            className={inputClass}
            value={value.percentage}
            onChange={(event) => {
              const percentage = Number(event.target.value);
              if (percentage === 10 || percentage === 20 || percentage === 33 || percentage === 66)
                onChange({ mode: "percentage", percentage });
            }}>
            {[10, 20, 33, 66].map((percentage) => (
              <option key={percentage} value={percentage}>
                {t("look_busy_hide_percentage", { percentage })}
              </option>
            ))}
          </select>
        </div>
      )}
      {value.mode !== "off" && <p className="text-subtle mt-4 text-sm">{t("look_busy_stability_help")}</p>}
    </fieldset>
  );
}
