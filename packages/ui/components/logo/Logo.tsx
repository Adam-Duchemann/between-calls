import { APP_NAME, LOGO_ICON } from "@calcom/lib/constants";
import classNames from "@calcom/ui/classNames";
export function Logo({
  small,
  icon,
  inline = true,
  className,
  src = LOGO_ICON,
}: {
  small?: boolean;
  icon?: boolean;
  inline?: boolean;
  className?: string;
  src?: string;
}) {
  return (
    <h3 className={classNames("logo", inline && "inline-flex", className)}>
      <strong className="inline-flex items-center gap-2">
        <img
          className={classNames("rounded-lg", small ? "h-6 w-6" : "h-9 w-9")}
          alt={icon ? APP_NAME : ""}
          src={src}
        />
        {!icon && (
          <span className={classNames("text-emphasis whitespace-nowrap", small ? "text-sm" : "text-lg")}>
            {APP_NAME}
          </span>
        )}
      </strong>
    </h3>
  );
}
