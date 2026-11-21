# Calendar and availability

CAL retains Cal.diy's schedule storage and booking services. Calendar view is available on the Bookings page without an experimental-feature opt-in.

## Editing hours

Availability offers Calendar and List views of the same draft. Draw, move across days or resize windows in 15-minute steps. Arrow keys move a focused window; Delete opens a named confirmation and Undo is available afterwards. Precise time inputs and the original list remain available. Small screens start in List view.

Weekly hours repeat in the schedule timezone. Specific dates override those hours; an explicitly closed date is different from removing an override, which restores weekly hours. Drag cancellation leaves the draft unchanged. If the week or its display settings change mid-drag, the editor discards that gesture and keeps the draft. Overlapping drawn windows merge. The server rejects malformed or overlapping saved intervals.

CAL resolves each endpoint of a weekly or date-specific window in the schedule timezone. If an opening falls inside the spring clock jump, it moves forward by the size of that jump. A late fall booking is checked against the actual elapsed window.

Save waits for the server. Reset returns to the last successfully saved draft. A partial save replaces only the weekly hours or date overrides it supplies. A rename preserves both; an empty overrides list restores the weekly hours for those dates. Saving a new default and edited hours commits both changes in one database transaction. Date override dialogs no longer save immediately in the web app. Changes made while a save is pending remain in the draft. Existing bookings and Google events are read-only overlays in date mode and are never moved by schedule edits. Working hours feed genuine availability before look-busy selection.

## Host calendar

The authenticated `calendars.hostCalendar` query returns only the requesting user's bookings and selected Google calendar events. Requests cover at most 35 days and 32 calendars. Calendar credentials remain on the server; responses use `private, no-store` caching. Bookings and each source can be toggled independently. All-day events appear above the timed week grid.

Google reads expand recurring instances and follow pagination. They retain free events, IDs, iCalendar UIDs and all-day status. Calendar-local midnight boundaries are resolved independently across daylight-saving changes. Provider failures stay visible per source, while successful sources can still render. A failed calendar is never represented as confirmed free time.

Duplicates match Google booking references, iCalendar UID plus instance times, or the same Google event and dated occurrence in a shared calendar. A connection's `primary` alias stays scoped to that account. Equal titles and times alone do not count as duplicates. Event positions and labels use the selected calendar timezone. In the availability editor, an interval spanning a repeated autumn hour retains its elapsed duration visibly; actual event timestamps remain unchanged.
