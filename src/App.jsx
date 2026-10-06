import { useEffect, useMemo, useRef, useState } from 'react'
import { geoNaturalEarth1, geoPath, geoGraticule10 } from 'd3-geo'
import { feature } from 'topojson-client'
import worldData from 'world-atlas/countries-110m.json'

const W = 960
const H = 500

const AREA_TO_COUNTRY = {
  Algerian: 'Algeria', Australian: 'Australia', British: 'United Kingdom',
  Canadian: 'Canada', Chinese: 'China', Croatian: 'Croatia', Egyptian: 'Egypt',
  Filipino: 'Philippines', Greek: 'Greece', Irish: 'Ireland', Italian: 'Italy',
  Jamaican: 'Jamaica', Japanese: 'Japan', Kenyan: 'Kenya', Malaysian: 'Malaysia',
  Mexican: 'Mexico', Moroccan: 'Morocco', Polish: 'Poland', Portuguese: 'Portugal',
  Russian: 'Russia', 'Saudi Arabian': 'Saudi Arabia', Spanish: 'Spain',
  Syrian: 'Syria', Thai: 'Thailand', Tunisian: 'Tunisia', Turkish: 'Turkey',
  Ukrainian: 'Ukraine', Uruguayan: 'Uruguay', Vietnamese: 'Vietnam',
}
const COUNTRY_TO_AREA = Object.fromEntries(
  Object.entries(AREA_TO_COUNTRY).map(([a, c]) => [c, a]),
)

function fmtYear(y) {
  if (y < 0) return `${Math.abs(y).toLocaleString()} BCE`
  if (y < 1000) return `${y} CE`
  return `${y}`
}

function dishesForStop(meals, stop) {
  if (!stop.dishTerms || stop.dishTerms.length === 0) return []
  const terms = stop.dishTerms.map((t) => t.toLowerCase())
  const scored = []
  for (const m of meals) {
    const name = m.name.toLowerCase()
    const ings = m.ingredients.map((i) => i.name.toLowerCase()).join(' | ')
    let s = 0
    for (const t of terms) {
      if (name.includes(t)) s += 3
      else if (ings.includes(t)) s += 1
    }
    if (s > 0 && stop.bias && m.area === stop.bias) s += 4
    if (s > 0) scored.push([s, m])
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name))
  return scored.slice(0, 6).map((x) => x[1])
}

export default function App() {
  const [bundle, setBundle] = useState(null)
  const [error, setError] = useState(null)
  const [journeyId, setJourneyId] = useState('chili')
  const [year, setYear] = useState(-6000)
  const [playing, setPlaying] = useState(false)
  const [pickedStop, setPickedStop] = useState(null)
  const [query, setQuery] = useState('')
  const [area, setArea] = useState('All')
  const [showAll, setShowAll] = useState(false)
  const [meal, setMeal] = useState(null)
  const [mapNote, setMapNote] = useState(null)
  const explorerRef = useRef(null)
  const timerRef = useRef(null)

  useEffect(() => {
    const loadMeals = fetch('/data/meals/index.json')
      .then((r) => r.json())
      .then((idx) =>
        Promise.all(idx.chunks.map((c) => fetch(`/data/meals/${c}`).then((r) => r.json()))),
      )
      .then((parts) => parts.flat())
    Promise.all([
      loadMeals,
      fetch('/data/meta.json').then((r) => r.json()),
      fetch('/data/journeys.json').then((r) => r.json()),
    ])
      .then(([meals, meta, journeysDoc]) => {
        setBundle({ meals, meta, journeys: journeysDoc.journeys, notes: journeysDoc.notes, world: worldData })
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
    timerRef.current = setInterval(() => {
      setYear((y) => {
        const step = Math.max(1, Math.round((maxYear - minYear) / 220))
        const next = y + step
        if (next >= maxYear) {
          setPlaying(false)
          return maxYear
        }
        return next
      })
    }, 40)
    return () => clearInterval(timerRef.current)
  }, [playing, journey, minYear, maxYear])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setMeal(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  const { meals, meta } = bundle
  const stops = journey.stops
  const revealed = stops.filter((s) => s.year <= year)
  const autoStop = Math.max(0, revealed.length - 1)
  const selectedStop = pickedStop !== null ? Math.min(pickedStop, stops.length - 1) : autoStop
  const activeStop = stops[selectedStop]
  const activeDishes = dishesForStop(meals, activeStop)

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
    const a = COUNTRY_TO_AREA[name]
    if (a) {
      setArea(a)
      setShowAll(false)
      setMapNote(`${name}: showing ${a} recipes from the snapshot below.`)
      explorerRef.current?.scrollIntoView({ behavior: 'smooth' })
    } else {
      setMapNote(`${name}: no cuisine snapshot in the current catalog yet.`)
    }
  }

  const q = query.trim().toLowerCase()
  const filtered = meals.filter((m) => {
    if (area !== 'All' && m.area !== area) return false
    if (!q) return true
    return (
      m.name.toLowerCase().includes(q) ||
      m.area.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q) ||
      m.ingredients.some((i) => i.name.toLowerCase().includes(q))
    )
  })
  const visibleMeals = showAll ? filtered : filtered.slice(0, 48)

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
          <h3>On the plate here</h3>
          {activeDishes.length === 0 ? (
            <p className="empty">No snapshot recipes matched this stop. The story still stands; the catalog just has not caught up.</p>
          ) : (
            <div className="dish-list">
              {activeDishes.map((m) => (
                <button key={m.id} className="dish" onClick={() => setMeal(m)}>
                  <img src={m.thumb} alt="" loading="lazy" />
                  <span>{m.name}<small>{m.area} · {m.category}</small></span>
                </button>
              ))}
            </div>
          )}
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
        </aside>
      </section>

      <section className="explorer" ref={explorerRef}>
        <div className="explorer-head">
          <h2>Recipe explorer</h2>
          <input
            type="search"
            placeholder="Search 472 recipes, ingredients, cuisines…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setShowAll(false) }}
            aria-label="Search recipes"
          />
        </div>
        <div className="area-chips">
          {['All', ...meta.areas].map((a) => (
            <button key={a} className={area === a ? 'chip on' : 'chip'} onClick={() => { setArea(a); setShowAll(false) }}>
              {a}
            </button>
          ))}
        </div>
        <p className="count">{filtered.length} recipe{filtered.length === 1 ? '' : 's'}{area !== 'All' ? ` · ${area}` : ''}{q ? ` · "${query.trim()}"` : ''}</p>
        {filtered.length === 0 ? (
          <p className="empty">Nothing in the snapshot matches that yet. Try a broader ingredient, like "chicken" or "tomato".</p>
        ) : (
          <div className="grid">
            {visibleMeals.map((m) => (
              <button key={m.id} className="card" onClick={() => setMeal(m)}>
                <img src={m.thumb} alt="" loading="lazy" />
                <span className="card-name">{m.name}</span>
                <span className="card-meta">{m.area} · {m.category}</span>
              </button>
            ))}
          </div>
        )}
        {!showAll && filtered.length > 48 && (
          <button className="show-all" onClick={() => setShowAll(true)}>Show all {filtered.length}</button>
        )}
      </section>

      <footer>
        <p>{bundle.notes}</p>
        <p>Recipe snapshot: {meta.source}, pulled {meta.snapshotDate} by the ETL in this repo (etl/fetch_themealdb.py). Map: Natural Earth via world-atlas. Phase 1.</p>
      </footer>

      {meal && (
        <div className="overlay" onClick={() => setMeal(null)}>
          <article className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setMeal(null)} aria-label="Close">×</button>
            <img src={meal.thumb} alt="" />
            <h2>{meal.name}</h2>
            <p className="card-meta">{meal.area} · {meal.category}{meal.tags.length ? ` · ${meal.tags.join(', ')}` : ''}</p>
            <h3>Ingredients</h3>
            <ul className="ingredients">
              {meal.ingredients.map((i, idx) => (
                <li key={idx}><span>{i.name}</span><span>{i.measure}</span></li>
              ))}
            </ul>
            <h3>Method</h3>
            {meal.instructions.split(/\r?\n+/).filter(Boolean).map((p, idx) => <p key={idx}>{p}</p>)}
            <p className="links">
              {meal.youtube && <a href={meal.youtube} target="_blank" rel="noreferrer">Watch on YouTube</a>}
              {meal.source && <a href={meal.source} target="_blank" rel="noreferrer">Original source</a>}
            </p>
          </article>
        </div>
      )}
    </div>
  )
}
