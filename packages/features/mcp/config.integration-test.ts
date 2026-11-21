// @vitest-environment node
import { randomUUID } from "node:crypto";
import process from "node:process";
import prisma from "@calcom/prisma";
import { beforeAll, expect, it } from "vitest";
import { ConfigChanges } from "./ConfigChanges";

beforeAll(() => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "55432")
    throw new Error("Use the isolated CAL loopback database on port 55432.");
});

it("creates an owned event with defaults and preserves schedule hours on a rename", async () => {
  const rollback = new Error("Rollback MCP configuration fixtures");
  await expect(
    prisma.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: {
            email: `mcp-config-${randomUUID()}@example.test`,
            emailVerified: new Date(),
            timeZone: "Indian/Reunion",
          },
          select: { id: true },
        });
        const schedule = await tx.schedule.create({
          data: {
            userId: user.id,
            name: "Work",
            timeZone: "Indian/Reunion",
            availability: {
              create: [
                {
                  days: [1, 2],
                  startTime: new Date("1970-01-01T09:00:00Z"),
                  endTime: new Date("1970-01-01T17:00:00Z"),
                },
                {
                  days: [],
                  date: new Date("2026-11-17"),
                  startTime: new Date("1970-01-01T00:00:00Z"),
                  endTime: new Date("1970-01-01T00:00:00Z"),
                },
              ],
            },
          },
          select: { id: true },
        });
        await tx.user.update({ where: { id: user.id }, data: { defaultScheduleId: schedule.id } });
        const service = new ConfigChanges(tx);
        const created = await service.apply(
          user.id,
          await service.prepare(user.id, {
            kind: "event_type_create",
            title: "Intro",
            slug: "intro",
            length: 30,
          })
        );
        const event = await tx.eventType.findFirstOrThrow({
          where: { userId: user.id, slug: "intro" },
          select: {
            id: true,
            afterEventBuffer: true,
            minimumBookingNotice: true,
            users: { select: { id: true } },
          },
        });
        expect(created.id).toBe(event.id);
        expect(event).toMatchObject({
          afterEventBuffer: 15,
          minimumBookingNotice: 240,
          users: [{ id: user.id }],
        });
        await service.apply(
          user.id,
          await service.prepare(user.id, {
            kind: "availability_update",
            scheduleId: schedule.id,
            changes: { name: "Renamed" },
          })
        );
        const stored = await tx.schedule.findUniqueOrThrow({
          where: { id: schedule.id },
          select: {
            name: true,
            availability: { select: { days: true, date: true, startTime: true, endTime: true } },
          },
        });
        expect(stored.name).toBe("Renamed");
        expect(stored.availability).toHaveLength(3);
        expect(stored.availability.find((row) => row.date)?.date?.toISOString()).toBe(
          "2026-11-17T00:00:00.000Z"
        );
        await expect(
          service.prepare(user.id + 100000, {
            kind: "event_type_update",
            eventTypeId: event.id,
            changes: { title: "Other" },
          })
        ).rejects.toThrow();
        throw rollback;
      },
      { isolationLevel: "Serializable", timeout: 20000 }
    )
  ).rejects.toBe(rollback);
});

it("a concurrent UI edit survives a serializable MCP schedule update", async () => {
  const email = `mcp-race-${randomUUID()}@example.test`;
  const user = await prisma.user.create({ data: { email, emailVerified: new Date() }, select: { id: true } });
  let release: () => void = () => {};
  let ready: () => void = () => {};
  const resumed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prepared = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let inflight: Promise<unknown> | undefined;
  try {
    const schedule = await prisma.schedule.create({
      data: { userId: user.id, name: "Original" },
      select: { id: true },
    });
    inflight = prisma.$transaction(
      async (tx) => {
        const service = new ConfigChanges(tx);
        const change = await service.prepare(user.id, {
          kind: "availability_update",
          scheduleId: schedule.id,
          changes: { name: "MCP" },
        });
        ready();
        await resumed;
        return service.apply(user.id, change);
      },
      { isolationLevel: "Serializable", timeout: 20000 }
    );
    await Promise.race([prepared, inflight]);
    await prisma.schedule.update({ where: { id: schedule.id }, data: { name: "Concurrent UI edit" } });
    release();
    await expect(inflight).rejects.toMatchObject({ code: "P2034" });
    expect(
      (await prisma.schedule.findUniqueOrThrow({ where: { id: schedule.id }, select: { name: true } })).name
    ).toBe("Concurrent UI edit");
  } finally {
    release();
    await inflight?.catch(() => {});
    await prisma.user.delete({ where: { id: user.id, email } });
  }
});
