import { BookingChanges } from "@calcom/features/mcp/BookingChanges";
import { ConfigChanges } from "@calcom/features/mcp/ConfigChanges";
import { ProposalService } from "@calcom/features/mcp/ProposalService";
import { ReadService } from "@calcom/features/mcp/ReadService";
import prisma from "@calcom/prisma";
import { mcpConfig } from "./_shared";

export function schedulingServices() {
  const bookings = new BookingChanges(prisma);
  const config = new ConfigChanges(prisma);
  return {
    reads: new ReadService(prisma),
    proposals: new ProposalService({
      prisma,
      secret: mcpConfig().secret,
      prepare: (userId, action) => {
        if (
          action.kind === "booking_create" ||
          action.kind === "booking_reschedule" ||
          action.kind === "booking_cancel"
        )
          return bookings.prepare(userId, action);
        return config.prepare(userId, action);
      },
      execute: (userId, change, proposalId) => {
        if (
          change.action.kind === "booking_create" ||
          change.action.kind === "booking_reschedule" ||
          change.action.kind === "booking_cancel"
        )
          return bookings.apply(userId, change, proposalId);
        return prisma.$transaction((tx) => new ConfigChanges(tx).apply(userId, change), {
          isolationLevel: "Serializable",
        });
      },
    }),
  };
}
