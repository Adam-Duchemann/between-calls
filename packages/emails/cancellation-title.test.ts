import { createInstance } from "i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "@calcom/types/Calendar";
import { sendCancelledEmailsAndSMS } from "./email-manager";

const sent = vi.hoisted(() => ({ attendee: vi.fn(), organizer: vi.fn() }));
vi.mock("./templates/attendee-cancelled-email", () => ({
  default: class {
    constructor(private event: CalendarEvent) {}
    sendEmail() {
      sent.attendee(this.event);
      return Promise.resolve();
    }
  },
}));
vi.mock("./templates/organizer-cancelled-email", () => ({
  default: class {
    constructor(private input: { calEvent: CalendarEvent }) {}
    sendEmail() {
      sent.organizer(this.input.calEvent);
      return Promise.resolve();
    }
  },
}));
vi.mock("../sms/attendee/event-cancelled-sms", () => ({
  default: class {
    async sendSMSToAttendees() {}
  },
}));

async function fixture() {
  const i18n = createInstance();
  await i18n.init({
    lng: "en",
    resources: {
      en: {
        translation: {
          event_between_users: "{{eventName}} between {{host}} and {{attendeeName}}",
        },
      },
    },
  });
  const language = { locale: "en", translate: i18n.t };
  return {
    title: "Intro between Adam and Guest",
    type: "intro",
    length: 30,
    startTime: "2026-11-18T07:30:00Z",
    endTime: "2026-11-18T08:00:00Z",
    organizer: { name: "Adam", email: "owner@example.test", timeZone: "Indian/Reunion", language },
    attendees: [{ name: "Guest", email: "guest@example.test", timeZone: "Indian/Reunion", language }],
  } satisfies CalendarEvent;
}

beforeEach(() => vi.clearAllMocks());
describe("cancellation email titles", () => {
  it("formats the event type once instead of expanding the stored booking title again", async () => {
    const event = await fixture();
    await sendCancelledEmailsAndSMS(event, { eventName: null, eventType: "Intro" });
    expect(sent.attendee.mock.calls[0][0].title).toBe(event.title);
    expect(sent.organizer.mock.calls[0][0].title).toBe(event.title);
    expect(event.title).toBe("Intro between Adam and Guest");
  });
  it("expands custom names using the raw event type title", async () => {
    await sendCancelledEmailsAndSMS(await fixture(), {
      eventName: "{Event type title}: {HOST} / {ATTENDEE}",
      eventType: "Intro",
    });
    expect(sent.attendee.mock.calls[0][0].title).toBe("Intro: Adam / Guest");
  });
  it("keeps the stored title when the event type no longer exists", async () => {
    const event = await fixture();
    await sendCancelledEmailsAndSMS(event, { eventName: null });
    expect(sent.attendee.mock.calls[0][0].title).toBe(event.title);
  });
});
