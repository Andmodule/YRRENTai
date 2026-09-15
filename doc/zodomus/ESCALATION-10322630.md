# Zodomus escalation — property `10322630`

**Date:** 2026-09-12  
**Account:** Alenrom sp. z o.o. (`api_status: Production API`)  
**Channel:** Booking.com (`channelId: 1`)  
**Property / hotel id:** `10322630` (K22 Large Family Apart Komputerowa)  
**RentAI property UUID:** `fc7c30ce-5bd5-4386-aefd-70d1f2aadb23`  
**Intent:** Re-open inventory on Booking for nights **2026-11-02** and **2026-11-04** (stays 2–3 Nov and 4–5 Nov) after CRM cancel / availability push. Local CRM cancel works; outbound `POST /availability-multiple` fails with **Property status not Active**.

## Ask to Zodomus support

Please unlock channel access and move this property to **Active** so we can push availability.

We already completed mapping basics from your tutorial:

1. `GET /channels` — OK  
2. Property already registered (`POST /property-activation` → *Property id exists… use property-cancellation*)  
3. Product status / Room status — **OK** on `POST /property-check`  
4. Re-ran `POST /rooms-activation` with mapped room/rate ids → **failed** (see below)

Still blocked on Channel / Property Active. Fresh ops run: `doc/zodomus/_tmp-10322630-ops.json` (`2026-09-12T18:08:40Z`).

## Evidence (fresh `POST /property-check`, channel 1)

```json
{
  "returnCode": "400",
  "returnMessage": {
    "Property status": "Evaluation OTA",
    "Channel status": "Error: Zodomus is still waiting to access channel data. Please check with support",
    "Product status": "OK",
    "Room status": "OK"
  }
}
```

## Related upstream faults

- `POST /rooms-activation`: **`Channel rooms and rates are not mapped. Check if you notified your channel about using Zodomus as a channel manager`**
- `GET /room-rates`: Booking.com **`HOTEL_ACCESS_DENIED`** / `403 Forbidden` (`Request for forbidden hotel`)
- `GET /availability`: **`403 Forbidden` / `Request for forbidden hotel id(s)`**
- Earlier `POST /availability-multiple` / reopen: **`Property status not Active`**

## Remapping already done (owner-approved)

At `2026-09-12T18:11:39Z` we ran full remapping on production:

1. `POST /property-cancellation` → **OK** (`Property 10322630 was cancelled`)
2. `POST /property-activation` (priceModelId=1) → **OK** (`…awaiting approval`)
3. `GET /room-rates` → still **HOTEL_ACCESS_DENIED** / Booking 403
4. `POST /rooms-activation` → **Channel rooms and rates are not mapped… notified your channel about using Zodomus as a channel manager**
5. `POST /availability-multiple` → still **Property status not Active**

Please confirm Zodomus↔Booking Connectivity for hotel `10322630` in the Booking Provider Portal and approve Evaluation OTA → Active.

## Desired outcome

1. Channel status no longer “waiting to access channel data”  
2. `POST /property-check` → Property **Active**, Channel OK  
3. `GET /room-rates` works (no HOTEL_ACCESS_DENIED)  
4. `POST /rooms-activation` + `POST /availability-multiple` succeed for room `1032263001` on Nov 2026 dates above  

## Contact note

Weekend reply suggested rooms activation; after cancel+activate the blocker is still **Booking HOTEL_ACCESS_DENIED** / missing CM connection notification — not a missing RentAI API call.
