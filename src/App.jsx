import { useEffect, useMemo, useRef, useState } from 'react'
import { geoNaturalEarth1, geoPath, geoGraticule10 } from 'd3-geo'
import { feature } from 'topojson-client'
import worldData from 'world-atlas/countries-110m.json'

const W = 960
const H = 500

function fmtYear(y) {
  if (y < 0) return `${Math.abs(y).toLocaleString()} BCE`
  if (y < 1000) return `${y} CE`
  return `${y}`
}

export default function App() {
  const [bundle, setBundle] = useState(null)
  const [error, setError] = useState(null)
  const [journeyId, setJourneyId] = useState('chili')
  const [year, setYear] = useState(-6000)
  const [playing, setPlaying] = useState(false)
  const [pickedStop, setPickedStop] = useState(null)
  const [mapNote, setMapNote] = useState(null)
  const timerRef = useRef(null)

  useEffect(() => {
    // Phase B: the catalog is demoted out of the primary UI. Dishes live only
    // inside stop cards as argued highlight dishes; meal chunk data stays in
    // the repo (public/data/meals/) but is no longer fetched or rendered.
    Promise.all([
      fetch('/data/meta.json').then((r) => r.json()),
      fetch('/data/journeys.json').then((r) => r.json()),
    ])
      .then(([meta, journeysDoc]) => {
        setBundle({ meta, journeys: journeysDoc.journeys, notes: journeysDoc.notes, world: worldData })
        // Phase A: journeys that meet the new content standard are the default view
        const defJourney = journeysDoc.journeys.find((j) => j.standard === 'new') || journeysDoc.journeys[0]
        setJourneyId(defJourney.id)
        setYear(defJourney.stops[0].year)
        setPlaying(true)
      })
      .catch((e) => setError(e.message))
  }, [])

  const journey = useMemo(() => {
    if (!bundle) return null
    return bundle.journeys.find((j) => j.id === journeyId) || bundle.journeys[0]
  }, [bundle, journeyId])

  const minYear = journey ? journey.stops[0].year : 0
  const maxYear = journey ? journey.stops[journey.stops.length - 1].year : 0

  useEffect(() => {
    if (!playing || !journey) return
    // Pace by STOPS, not years. Stop years are wildly uneven (chili: a 7,400-year
    // gap, then 16-year gaps), so a fixed year-step meant seconds of dead time
    // followed by unreadable card flips. Every gap now takes DWELL ms, so each
    // stop's story gets the same screen time and the dot travels at a readable pace.
    const DWELL = 2600
    const TICK = 40
    timerRef.current = setInterval(() => {
      setYear((y) => {
        const ss = journey.stops
        let i = 0
        while (i < ss.length - 1 && ss[i + 1].year <= y) i++
        if (i >= ss.length - 1) {
          setPlaying(false)
          return maxYear
        }
        const gap = ss[i + 1].year - ss[i].year
        const step = gap > 0 ? gap / (DWELL / TICK) : 1
        const next = y + step
        return next >= ss[i + 1].year ? ss[i + 1].year : next
      })
    }, TICK)
    return () => clearInterval(timerRef.current)
  }, [playing, journey, minYear, maxYear])

  const geo = useMemo(() => {
    if (!bundle) return null
    const countries = feature(bundle.world, bundle.world.objects.countries)
    const projection = geoNaturalEarth1().fitExtent([[4, 8], [W - 4, H - 8]], countries)
    return { countries, projection, path: geoPath(projection) }
  }, [bundle])

  if (error) {
    return <div className="boot"><p>Could not load the atlas data: {error}</p></div>
  }
  if (!bundle || !journey || !geo) {
    return <div className="boot"><p>Loading the atlas…</p></div>
  }

  const { meta } = bundle
  const stops = journey.stops
  const revealed = stops.filter((s) => s.year <= year)
  const autoStop = Math.max(0, revealed.length - 1)
  const selectedStop = pickedStop !== null ? Math.min(pickedStop, stops.length - 1) : autoStop
  const activeStop = stops[selectedStop]

  const routePts = revealed.map((s) => [s.lon, s.lat])
  const nextStop = stops[revealed.length]
  if (nextStop && revealed.length > 0 && year > revealed[revealed.length - 1].year) {
    const last = revealed[revealed.length - 1]
    const span = nextStop.year - last.year
    const f = span > 0 ? (year - last.year) / span : 0
    routePts.push([last.lon + (nextStop.lon - last.lon) * f, last.lat + (nextStop.lat - last.lat) * f])
  }
  const fullRoute = { type: 'LineString', coordinates: stops.map((s) => [s.lon, s.lat]) }
  const liveRoute = routePts.length > 1 ? { type: 'LineString', coordinates: routePts } : null

  const pickJourney = (id) => {
    const j = bundle.journeys.find((x) => x.id === id)
    setJourneyId(id)
    setYear(j.stops[0].year)
    setPickedStop(null)
    setPlaying(true)
    setMapNote(null)
  }

  const onCountry = (name) => {
    // Phase B: the catalog is demoted out of the primary UI. Country taps
    // now just explain; dishes live only inside the stop cards.
    const inJourney = stops.some((s) => s.country === name
      || (s.country || '').includes(name) || name.includes(s.country))
    setMapNote(inJourney
      ? `${name}: on the ${journey.name} journey \u2014 follow the stops below.`
      : `${name}: no journey passes through ${name} yet.`)
  }

  return (
    <div className="page" style={{ '--accent': journey.color }}>
      <header className="masthead">
        <div>
          <h1>Recipe Atlas</h1>
          <p className="tagline">How food moved through the world</p>
        </div>
        <div className="stats">
          <span><strong>{meta.mealCount}</strong> recipes</span>
          <span><strong>{meta.areas.length}</strong> cuisines</span>
          <span><strong>{meta.ingredientCount}</strong> ingredients</span>
          <span><strong>{bundle.journeys.length}</strong> journeys</span>
        </div>
      </header>

      <nav className="journey-tabs" aria-label="Ingredient journeys">
        {bundle.journeys.map((j) => (
          <button
            key={j.id}
            className={j.id === journeyId ? 'tab active' : 'tab'}
            style={{ '--tab': j.color }}
            onClick={() => pickJourney(j.id)}
          >
            {j.name}
            {j.standard === 'new' && <span className="std-pill">new</span>}
          </button>
        ))}
      </nav>

      {journey.framing && (
        <p className="framing"><strong>Why it matters:</strong> {journey.framing}</p>
      )}

      <div className="howto">
        <strong>Follow the journey:</strong> press play and watch {journey.name} travel
        from {stops[0].place} to {stops[stops.length - 1].place} in {stops.length} stops.
        Each stop is a place it arrived and changed how people cook. Drag the timeline
        to travel yourself, or tap any stop on the map.
      </div>

      <section className="stage">
        <div className="map-wrap">
          <svg viewBox={`0 0 ${W} ${H}`} className="map" role="img" aria-label={`World map of the ${journey.name} journey`}>
            <path d={geo.path(geoGraticule10())} className="graticule" />
            {geo.countries.features.map((f) => (
              <path
                key={f.id || f.properties.name}
                d={geo.path(f)}
                className="country"
                onClick={() => onCountry(f.properties.name)}
              >
                <title>{f.properties.name}</title>
              </path>
            ))}
            <path d={geo.path(fullRoute)} className="route-ghost" />
            {liveRoute && <path d={geo.path(liveRoute)} className="route-live" />}
            {stops.map((s, i) => {
              const [x, y] = geo.projection([s.lon, s.lat])
              const isRevealed = s.year <= year
              const isActive = i === selectedStop
              return (
                <g key={s.place} className="stop" onClick={() => { setPickedStop(i); if (!isRevealed) setYear(s.year) }}>
                  <circle cx={x} cy={y} r="16" className="hit" />
                  {isActive && isRevealed && <circle cx={x} cy={y} r="10" className="pulse" />}
                  <circle cx={x} cy={y} r={isActive ? 6 : 4.5} className={isRevealed ? 'dot on' : 'dot'} />
                  {(isRevealed || isActive) && (
                    <text x={x} y={y - 11} className="stop-label">{s.place}</text>
                  )}
                </g>
              )
            })}
          </svg>
          {mapNote && <p className="map-note">{mapNote}</p>}
          <div className="timeline">
            <button className="play" onClick={() => { if (year >= maxYear) setYear(minYear); setPickedStop(null); setPlaying((p) => !p) }} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? '❚❚' : '▶'}
            </button>
            <span className="year-read">{fmtYear(Math.round(year))}</span>
            <input
              type="range"
              min={minYear}
              max={maxYear}
              value={year}
              aria-label="Timeline"
              onChange={(e) => { setPlaying(false); setPickedStop(null); setYear(Number(e.target.value)) }}
            />
            <div className="era-ticks">
              {stops.map((s, i) => (
                <button key={s.place} className={i === selectedStop ? 'tick on' : 'tick'} onClick={() => { setPlaying(false); setYear(s.year); setPickedStop(i) }}>
                  {s.era}
                </button>
              ))}
            </div>
          </div>
        </div>

        <aside className="stop-card">
          <div key={selectedStop} className="stop-card-body">
          <p className="kicker">{journey.name} · {activeStop.era}</p>
          {journey.standard === 'new' && (
            <p className="std-badge">New-standard journey · researched from the dossier</p>
          )}
          <h2>{activeStop.place}</h2>
          <p className="country-name">{activeStop.country}</p>
          <p className="note">{activeStop.note}</p>
          {activeStop.use && (
            <>
              <h3>How it was used</h3>
              <p className="use">{activeStop.use}</p>
            </>
          )}
          {activeStop.highlightDish && (
            <>
              <h3>Highlight dish</h3>
              <div className="highlight">
                <p className="hd-name">{activeStop.highlightDish.name}</p>
                <p className="hd-blurb">{activeStop.highlightDish.blurb}</p>
                <p className="hd-why"><strong>Why this dish:</strong> {activeStop.highlightDish.why}</p>
              </div>
            </>
          )}
          <p className="journey-tag">{journey.tagline}</p>
          {journey.sources && journey.sources.length > 0 && (
            <>
              <h3>Sources for this journey</h3>
              <ul className="sources">
                {journey.sources.map((s) => (
                  <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.label}</a></li>
                ))}
              </ul>
            </>
          )}
          <p className="stop-count">Stop {selectedStop + 1} of {stops.length}</p>
          </div>
        </aside>
      </section>


      <footer>
        <p>{bundle.notes}</p>
        <p>Recipe snapshot: {meta.source}, pulled {meta.snapshotDate} by the ETL in this repo (etl/fetch_themealdb.py). Map: Natural Earth via world-atlas. Phase 1.</p>
      </footer>

    </div>
  )
}
