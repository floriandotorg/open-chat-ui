import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ToolDefinition } from './types'

const execFileAsync = promisify(execFile)

const TIMEOUT_MS = 60_000
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 20
const DEFAULT_DATES_LIMIT = 5
const MAX_DATES_LIMIT = 6

const CABIN_CLASSES = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'] as const

const STOP_VALUES = ['ANY', 'NON_STOP', 'ONE_STOP', 'TWO_PLUS_STOPS'] as const

const SORT_VALUES = ['CHEAPEST', 'DURATION', 'DEPARTURE_TIME', 'ARRIVAL_TIME'] as const

const isOneOf = <T extends string>(v: unknown, allowed: readonly T[]): v is T => typeof v === 'string' && (allowed as readonly string[]).includes(v.toUpperCase())

const enumValue = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined => {
  if (!isOneOf(v, allowed)) return undefined
  return (v as string).toUpperCase() as T
}

const splitList = (v: unknown): string[] =>
  String(v ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

const fmtDuration = (minutes: number): string => {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

const fmtTime = (iso: string): string => (iso ?? '').replace('T', ' ').slice(0, 16)

interface Airport {
  code?: string
  name?: string
}
interface Airline {
  code?: string
  name?: string
}
interface Leg {
  departure_airport?: Airport
  arrival_airport?: Airport
  departure_time?: string
  arrival_time?: string
  duration?: number
  airline?: Airline
  flight_number?: string
  aircraft?: string
}
interface Layover {
  airport?: Airport
  duration?: number
}
interface FlightSegment {
  duration?: number
  stops?: number
  legs?: Leg[]
  layovers?: Layover[]
}
interface FlightResult {
  duration?: number
  stops?: number
  legs?: Leg[]
  price?: number
  currency?: string
  layovers?: Layover[]
  booking_url?: string
  outbound?: FlightSegment
  return?: FlightSegment
}
interface FlightsResponse {
  success?: boolean
  count?: number
  flights?: FlightResult[]
  booking_url?: string
  error?: string
}

interface DatePrice {
  departure_date?: string
  return_date?: string | null
  price?: number
  currency?: string
  booking_url?: string
}
interface DatesResponse {
  success?: boolean
  count?: number
  dates?: DatePrice[]
  error?: string
}

const runFli = async (args: string[]): Promise<string> => {
  try {
    const { stdout } = await execFileAsync('fli', args, { timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 })
    return stdout
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string; code?: number | string }
    if (err.code === 'ENOENT') {
      return 'Error: The `fli` CLI is not installed. Install it with `pipx install flights` (and `pipx inject flights click`) and try again.'
    }
    const stderr = (err.stderr ?? '').trim()
    if (stderr) return `Error: fli failed: ${stderr.slice(0, 1000)}`
    return `Error: fli failed: ${err.message.slice(0, 1000)}`
  }
}

const parseJson = <T>(raw: string): T | null => {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

const formatLeg = (leg: Leg): string => {
  const dep = leg.departure_airport?.code ?? '???'
  const arr = leg.arrival_airport?.code ?? '???'
  const airline = leg.airline?.code ?? leg.airline?.name ?? '??'
  const fn = leg.flight_number ?? ''
  const flightNo = fn ? ` ${fn}` : ''
  const depTime = leg.departure_time ? fmtTime(leg.departure_time) : '?'
  const arrTime = leg.arrival_time ? fmtTime(leg.arrival_time) : '?'
  const dur = leg.duration ? ` · ${fmtDuration(leg.duration)}` : ''
  const aircraft = leg.aircraft ? ` · ${leg.aircraft}` : ''
  return `${airline}${flightNo} ${dep} → ${arr} · ${depTime} → ${arrTime}${dur}${aircraft}`
}

const formatSegment = (seg: FlightSegment, label?: string): string => {
  const legs = (seg.legs ?? []).map(l => formatLeg(l)).join('\n')
  const layovers = (seg.layovers ?? [])
    .filter((l): l is Layover & { duration: number } => l.duration != null)
    .map(l => `${l.airport?.code ?? '???'} ${fmtDuration(l.duration)}`)
    .join(', ')
  const meta = label ? `${label}${seg.duration ? ` · ${fmtDuration(seg.duration)}` : ''}${seg.stops != null ? ` · ${seg.stops === 0 ? 'nonstop' : `${seg.stops} stop${seg.stops === 1 ? '' : 's'}`}` : ''}` : ''
  const labelLine = meta ? `**${meta}**\n` : ''
  const layoverLine = layovers ? `\nLayovers: ${layovers}` : ''
  return `${labelLine}${legs}${layoverLine}`
}

const flightBody = (f: FlightResult): string => {
  const outbound = f.outbound
  const returnLegs = f.return ? `\n${formatSegment(f.return, 'Return')}` : ''
  return outbound ? `${formatSegment(outbound, 'Outbound')}${returnLegs}` : formatSegment(f)
}

const formatFlight = (f: FlightResult, n: number, fallbackBookingUrl?: string): string => {
  const price = f.price != null ? `${f.currency ?? 'EUR'} ${f.price}` : 'Price unavailable'
  const dur = f.duration != null ? fmtDuration(f.duration) : '?'
  const stops = f.stops ?? 0
  const stopLabel = stops === 0 ? 'nonstop' : `${stops} stop${stops === 1 ? '' : 's'}`
  const bookingUrl = f.booking_url ?? fallbackBookingUrl
  const bookingLine = bookingUrl ? `\n[Book on Google Flights →](${bookingUrl})` : ''
  return `**${n} · ${price} · ${dur} · ${stopLabel}**\n${flightBody(f)}${bookingLine}`
}

const fetchTopFlight = async (origin: string, destination: string, departureDate: string, returnDate: string | undefined, cabin: string, stops: string): Promise<FlightResult | null> => {
  const cmd: string[] = ['flights', origin, destination, departureDate, '--format', 'json', '--class', cabin, '--stops', stops, '--sort', 'CHEAPEST', '--currency', 'EUR']
  if (returnDate) cmd.push('--return', returnDate)
  const raw = await runFli(cmd)
  if (raw.startsWith('Error:')) return null
  const data = parseJson<FlightsResponse>(raw)
  if (!data || data.success === false || !data.flights?.length) return null
  return data.flights[0] ?? null
}

export const searchFlights: ToolDefinition = {
  name: 'search_flights',
  description: 'Search for flights on a specific date via Google Flights (powered by the `fli` CLI). Returns priced itineraries with legs, airlines, times, stops, and layovers. Use IATA airport codes (e.g. JFK, LHR). Requires the `fli` CLI installed (`pipx install flights`).',
  parameters: {
    type: 'object',
    properties: {
      origin: {
        type: 'string',
        description: 'Departure airport IATA code(s), comma-separated for multi-city (e.g. "JFK" or "JFK,EWR").',
      },
      destination: {
        type: 'string',
        description: 'Arrival airport IATA code(s), comma-separated for multi-city.',
      },
      departure_date: {
        type: 'string',
        description: 'Departure date in YYYY-MM-DD format.',
      },
      return_date: {
        type: 'string',
        description: 'Return date in YYYY-MM-DD format for round trips. Omit for one-way.',
      },
      cabin_class: {
        type: 'string',
        description: 'Cabin class. One of ECONOMY, PREMIUM_ECONOMY, BUSINESS, FIRST. Defaults to ECONOMY.',
        enum: [...CABIN_CLASSES],
      },
      max_stops: {
        type: 'string',
        description: 'Maximum stops. One of ANY, NON_STOP, ONE_STOP, TWO_PLUS_STOPS. Defaults to ANY.',
        enum: [...STOP_VALUES],
      },
      sort_by: {
        type: 'string',
        description: 'Sort order. One of CHEAPEST, DURATION, DEPARTURE_TIME, ARRIVAL_TIME. Defaults to CHEAPEST.',
        enum: [...SORT_VALUES],
      },
      airlines: {
        type: 'string',
        description: 'Comma-separated airline IATA codes to include (e.g. "BA,KL").',
      },
      exclude_airlines: {
        type: 'string',
        description: 'Comma-separated airline IATA codes to exclude (e.g. "DL,B6").',
      },
      limit: {
        type: 'integer',
        description: `Number of itineraries to return (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT}).`,
      },
    },
    required: ['origin', 'destination', 'departure_date'],
  },
  execute: async args => {
    const origin = String(args.origin ?? '').trim()
    const destination = String(args.destination ?? '').trim()
    const departureDate = String(args.departure_date ?? '').trim()
    if (!origin || !destination || !departureDate) {
      return 'Error: "origin", "destination", and "departure_date" are required.'
    }

    const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor((args.limit as number) ?? DEFAULT_LIMIT)))
    const cabin = enumValue(args.cabin_class, CABIN_CLASSES) ?? 'ECONOMY'
    const stops = enumValue(args.max_stops, STOP_VALUES) ?? 'ANY'
    const sort = enumValue(args.sort_by, SORT_VALUES) ?? 'CHEAPEST'
    const airlines = splitList(args.airlines)
    const excludeAirlines = splitList(args.exclude_airlines)
    const returnDate = (args.return_date as string | undefined)?.trim() || undefined

    const cmd: string[] = ['flights', origin, destination, departureDate, '--format', 'json', '--class', cabin, '--stops', stops, '--sort', sort, '--currency', 'EUR']
    if (returnDate) cmd.push('--return', returnDate)
    if (airlines.length) cmd.push('--airlines', airlines.join(','))
    if (excludeAirlines.length) cmd.push('--exclude-airlines', excludeAirlines.join(','))

    const raw = await runFli(cmd)
    if (raw.startsWith('Error:')) return raw

    const data = parseJson<FlightsResponse>(raw)
    if (!data) return `Error: Could not parse fli output.\n${raw.slice(0, 500)}`

    if (data.success === false || data.error) return `Error: ${data.error ?? 'fli reported failure.'}`
    const flights = data.flights ?? []
    if (!flights.length) return 'No flights found for the given criteria.'

    const tripType = returnDate ? `round-trip · return ${returnDate}` : 'one-way'
    const route = `${origin} → ${destination} · ${departureDate} · ${tripType}`
    const header = `**${route}**\n${cabin.toLowerCase()} · ${stops.toLowerCase()} · ${sort.toLowerCase()} · ${data.count ?? flights.length} results — showing ${Math.min(limit, flights.length)}\n\n`
    return (
      header +
      flights
        .slice(0, limit)
        .map((f, n) => formatFlight(f, n + 1, data.booking_url))
        .join('\n\n')
    )
  },
}

export const searchFlightDates: ToolDefinition = {
  name: 'search_flight_dates',
  description: 'Find the cheapest flight dates across a date range via Google Flights (powered by the `fli` CLI), then fetch the full itinerary (airlines, legs, times, stops, layovers, booking link) for each of the top dates. Use IATA airport codes. Requires the `fli` CLI installed (`pipx install flights`).',
  parameters: {
    type: 'object',
    properties: {
      origin: {
        type: 'string',
        description: 'Departure airport IATA code(s), comma-separated for multi-city.',
      },
      destination: {
        type: 'string',
        description: 'Arrival airport IATA code(s), comma-separated for multi-city.',
      },
      start_date: {
        type: 'string',
        description: 'Start of the date range in YYYY-MM-DD format.',
      },
      end_date: {
        type: 'string',
        description: 'End of the date range in YYYY-MM-DD format.',
      },
      trip_duration: {
        type: 'integer',
        description: 'Trip duration in days (for round-trip searches). Defaults to 3.',
      },
      is_round_trip: {
        type: 'boolean',
        description: 'Whether to search round-trip flights. Defaults to false (one-way).',
      },
      cabin_class: {
        type: 'string',
        description: 'Cabin class. One of ECONOMY, PREMIUM_ECONOMY, BUSINESS, FIRST. Defaults to ECONOMY.',
        enum: [...CABIN_CLASSES],
      },
      max_stops: {
        type: 'string',
        description: 'Maximum stops. One of ANY, NON_STOP, ONE_STOP, TWO_PLUS_STOPS. Defaults to ANY.',
        enum: [...STOP_VALUES],
      },
      sort_by_price: {
        type: 'boolean',
        description: 'Sort results by price (lowest first). Defaults to true.',
      },
      limit: {
        type: 'integer',
        description: `Number of dates to return with full itineraries (1-${MAX_DATES_LIMIT}, default ${DEFAULT_DATES_LIMIT}). Each date triggers an extra flight lookup, so keep small.`,
      },
    },
    required: ['origin', 'destination', 'start_date', 'end_date'],
  },
  execute: async args => {
    const origin = String(args.origin ?? '').trim()
    const destination = String(args.destination ?? '').trim()
    const startDate = String(args.start_date ?? '').trim()
    const endDate = String(args.end_date ?? '').trim()
    if (!origin || !destination || !startDate || !endDate) {
      return 'Error: "origin", "destination", "start_date", and "end_date" are required.'
    }

    const limit = Math.max(1, Math.min(MAX_DATES_LIMIT, Math.floor((args.limit as number) ?? DEFAULT_DATES_LIMIT)))
    const cabin = enumValue(args.cabin_class, CABIN_CLASSES) ?? 'ECONOMY'
    const stops = enumValue(args.max_stops, STOP_VALUES) ?? 'ANY'
    const tripDuration = Math.max(1, Math.floor((args.trip_duration as number) ?? 3))
    const isRoundTrip = Boolean(args.is_round_trip)
    const sortByPrice = args.sort_by_price === undefined ? true : Boolean(args.sort_by_price)

    const cmd: string[] = ['dates', origin, destination, '--from', startDate, '--to', endDate, '--duration', String(tripDuration), '--format', 'json', '--class', cabin, '--stops', stops, '--currency', 'EUR']
    if (isRoundTrip) cmd.push('--round')
    if (sortByPrice) cmd.push('--sort')

    const raw = await runFli(cmd)
    if (raw.startsWith('Error:')) return raw

    const data = parseJson<DatesResponse>(raw)
    if (!data) return `Error: Could not parse fli output.\n${raw.slice(0, 500)}`

    if (data.success === false || data.error) return `Error: ${data.error ?? 'fli reported failure.'}`
    const allDates = data.dates ?? []
    if (!allDates.length) return 'No dated prices found for the given range.'

    const sortedDates = sortByPrice ? [...allDates].sort((a, b) => (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY)) : allDates
    const dates = sortedDates.slice(0, limit)

    const enriched = await Promise.all(dates.map(d => fetchTopFlight(origin, destination, d.departure_date ?? '', d.return_date ?? undefined, cabin, stops).then(f => ({ d, f }))))

    const cheapest = [...allDates].filter(d => d.price != null).sort((a, b) => (a.price ?? 0) - (b.price ?? 0))[0]
    const tripType = isRoundTrip ? `round-trip · ${tripDuration}d` : 'one-way'
    const route = `${origin} → ${destination} · ${startDate} to ${endDate} · ${tripType}`
    const cheapestNote = cheapest ? ` — cheapest ${cheapest.currency ?? 'EUR'} ${cheapest.price} on ${cheapest.departure_date}` : ''
    const header = `**${route}**\n${cabin.toLowerCase()} · ${stops.toLowerCase()} · ${data.count ?? allDates.length} dates${cheapestNote} — showing ${dates.length} with full itineraries\n\n`
    const lines = enriched.map(({ d, f }) => {
      const price = d.price != null ? `${d.currency ?? 'EUR'} ${d.price}` : '—'
      const ret = d.return_date ? ` (return ${d.return_date})` : ''
      if (!f) return `**${d.departure_date ?? '?'}${ret}** — ${price}\n_Itinerary unavailable — call search_flights for this date._`
      const dur = f.duration != null ? fmtDuration(f.duration) : '?'
      const stops2 = f.stops ?? 0
      const stopLabel = stops2 === 0 ? 'nonstop' : `${stops2} stop${stops2 === 1 ? '' : 's'}`
      const bookingUrl = f.booking_url
      const bookingLine = bookingUrl ? `\n[Book on Google Flights →](${bookingUrl})` : ''
      return `**${d.departure_date ?? '?'}${ret}** — ${price} · ${dur} · ${stopLabel}\n${flightBody(f)}${bookingLine}`
    })
    return header + lines.join('\n\n')
  },
}
