import { createServerFn } from "@tanstack/react-start";
import { callAppsScript } from "./appsScript";
import { requireUser } from "./session";
import type { EventBooking, EventBookingStatus, EventDepositPaymentMethod } from "@/lib/types";

export const getEventBookingsFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const res = await callAppsScript<{ items: EventBooking[] }>("getEventBookings", { username: user.username });
  return res.items;
});

export const addEventBookingFn = createServerFn({ method: "POST" })
  .validator((d: {
    customerName: string; phoneNumber: string; roomId?: string; roomName?: string;
    eventAt: number; depositAmount: number; depositPaymentMethod: EventDepositPaymentMethod;
    description: string; status?: EventBookingStatus;
  }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; item?: EventBooking }>("addEventBooking", { ...data, username: user.username });
  });

export const updateEventBookingFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; patch: Partial<Omit<EventBooking, "id" | "createdAt" | "createdBy">> }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string }>("updateEventBooking", { ...data, username: user.username });
  });

export const deleteEventBookingFn = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string }>("deleteEventBooking", { ...data, username: user.username });
  });
