import { useEffect, useMemo, useRef, useState } from 'react'
import { geoNaturalEarth1, geoPath, geoGraticule10, geoInterpolate } from 'd3-geo'
import { feature } from 'topojson-client'
import worldData from 'world-atlas/countries-110m.json'
import { INGREDIENTS, INGREDIENT_MAP } from './data/ingredients.js'

const W = 960
const H = 520

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

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/* ---------------- data loading ---------------- */

function useBundle() {
  const [bundle, setBundle] = useState(null)
  const [error, setError] = useState(null)
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
    ])
      .then(([meals, meta]) => setBundle({ meals, meta, world: worldData }))
      .catch((e) => setError(e.message))
  }, [])
  return { bundle, error }
}

function useGeo(bundle) {
  return useMemo(() => {
    if (!bundle) return null
    const countries = feature(bundle.world, bundle.world.objects.countries)
    const projection = geoNaturalEarth1().fitExtent([[6, 10], [W - 6, H - 10]], countries)
    return { countries, projection, path: geoPath(projection) }
  }, [bundle])
}

function dishesForIngredient(meals, ing) {
  const terms = ing.matchTerms.map((t) => t.toLowerCase())
  const scored = []
  for (const m of meals) {
    const name = m.name.toLowerCase()
    const ings = m.ingredients.map((i) => i.name.toLowerCase()).join(' | ')
    let s = 0
    for (const t of terms) {
      if (name.includes(t)) s += 3
      else if (ings.includes(t)) s += 1
    }
    if (s > 0) scored.push([s, m])
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name))
  return scored.slice(0, 8).map((x) => x[1])
}

/* ---------------- quiz generation ---------------- */

function buildQuiz(ing) {
  const qs = []
  const others = INGREDIENTS.filter((x) => x.id !== ing.id)
  // Q1: origin
  const originOpts = shuffle([
    ing.chapters[0].place,
    ...shuffle(others).slice(0, 3).map((o) => o.chapters[0].place),
  ])
  qs.push({
    q: `Where was the ${ing.name.toLowerCase()} first domesticated?`,
    options: originOpts,
    answer: ing.chapters[0].place,
  })
  // Chapter questions: what happened where
  const chaps = shuffle(ing.chapters.slice(1)).slice(0, 4)
  for (const c of chaps) {
    const wrong = shuffle(ing.chapters.filter((x) => x !== c)).slice(0, 3).map((x) => x.title)
    qs.push({
      q: `What happened in ${c.place} (${c.era})?`,
      options: shuffle([c.title, ...wrong]),
      answer: c.title,
    })
  }
  return qs.slice(0, 5)
}

/* ---------------- film view: the ingredient's movie ---------------- */

function FilmView({ ing, meals, geo, onBack, onOpenMeal, onPantryArea }) {
  const n = ing.chapters.length
  const [playing, setPlaying] = useState(true)
  const [activeIdx, setActiveIdx] = useState(0)
  const [tab, setTab] = useState('film')
  const [mapNote, setMapNote] = useState(null)

  const cf = useRef(0) // chapterFloat: continuous position along the story
  const activeRef = useRef(0)
  const playingRef = useRef(true)
  const gRef = useRef(null)
  const travelerRef = useRef(null)
  const trailRef = useRef(null)
  const camRef = useRef({ cx: W / 2, cy: H / 2, k: 1 })

  playingRef.current = playing

  const chapters = ing.chapters
  const proj = (c) => geo.projection([c.lon, c.lat])

  const travelerLonLat = (t) => {
    const i0 = Math.min(Math.floor(t), n - 2 < 0 ? 0 : n - 2)
    if (t >= n - 1) { const c = chapters[n - 1]; return [c.lon, c.lat] }
    const a = chapters[i0], b = chapters[i0 + 1]
    return geoInterpolate([a.lon, a.lat], [b.lon, b.lat])(t - i0)
  }

  useEffect(() => {
    cf.current = 0
    activeRef.current = 0
    setActiveIdx(0)
    setPlaying(true)
    camRef.current = { cx: W / 2, cy: H / 2, k: 1 }
  }, [ing.id])

  useEffect(() => {
    if (tab !== 'film') setPlaying(false)
  }, [tab])

  useEffect(() => {
    let raf
    let last = performance.now()
    const loop = (now) => {
      const dt = Math.min(100, now - last)
      last = now
      if (playingRef.current && tab === 'film') {
        cf.current = Math.min(n - 1, cf.current + dt / 5200)
        if (cf.current >= n - 1) setPlaying(false)
      }
      const t = cf.current
      // traveler
      const [tlon, tlat] = travelerLonLat(t)
      const [tx, ty] = geo.projection([tlon, tlat])
      if (travelerRef.current) travelerRef.current.setAttribute('transform', `translate(${tx} ${ty})`)
      // trail
      const i0 = Math.floor(t)
      const coords = chapters.slice(0, Math.min(i0 + 1, n)).map((c) => [c.lon, c.lat])
      coords.push([tlon, tlat])
      const line = { type: 'LineString', coordinates: coords }
      if (trailRef.current) trailRef.current.setAttribute('d', geo.path(line) || '')
      // camera eases toward the active chapter
      const ai = Math.round(t)
      const [ax, ay] = proj(chapters[ai])
      const cam = camRef.current
      cam.cx += (ax - cam.cx) * 0.045
      cam.cy += (ay - cam.cy) * 0.045
      const targetK = 1.55
      cam.k += (targetK - cam.k) * 0.045
      if (gRef.current) {
        gRef.current.setAttribute(
          'transform',
          `translate(${W / 2} ${H / 2}) scale(${cam.k.toFixed(3)}) translate(${(-cam.cx).toFixed(1)} ${(-cam.cy).toFixed(1)})`,
        )
      }
      if (ai !== activeRef.current) {
        activeRef.current = ai
        setActiveIdx(ai)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [ing.id, tab, n, geo])

  const goChapter = (i) => {
    const c = Math.max(0, Math.min(n - 1, i))
    cf.current = c
    activeRef.current = c
    setActiveIdx(c)
  }

  const active = chapters[activeIdx]
  const fullRoute = { type: 'LineString', coordinates: chapters.map((c) => [c.lon, c.lat]) }

  const onCountry = (name) => {
    const a = COUNTRY_TO_AREA[name]
    if (a) {
      onPantryArea(a)
    } else {
      setMapNote(`${name}: no cuisine snapshot in the pantry yet.`)
    }
  }

  return (
    <div className="film" style={{ '--accent': ing.color }}>
      <div className="film-top">
        <button className="back" onClick={onBack}>← All ingredients</button>
        <div className="film-tabs" role="tablist">
          {[
            ['film', `${ing.icon} Film`],
            ['cram', 'Cram sheet'],
            ['quiz', 'Quiz me'],
            ['plate', 'On the plate'],
          ].map(([id, label]) => (
            <button key={id} role="tab" className={tab === id ? 'tab active' : 'tab'} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'film' && (
        <>
          <section className="stage">
            <div className="map-wrap">
              <svg viewBox={`0 0 ${W} ${H}`} className="map" role="img" aria-label={`World map of the ${ing.name} journey`}>
                <defs>
                  <radialGradient id="ocean" cx="50%" cy="42%" r="75%">
                    <stop offset="0%" stopColor="#16324a" />
                    <stop offset="100%" stopColor="#0a1723" />
                  </radialGradient>
                </defs>
                <rect x="0" y="0" width={W} height={H} fill="url(#ocean)" />
                <g ref={gRef}>
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
                  <path ref={trailRef} className="route-live" d="" />
                  {chapters.map((c, i) => {
                    const [x, y] = proj(c)
                    const revealed = i <= activeIdx
                    const isActive = i === activeIdx
                    return (
                      <g key={c.place + i} className="stop" onClick={() => goChapter(i)}>
                        <circle cx={x} cy={y} r="18" className="hit" />
                        <circle cx={x} cy={y} r={isActive ? 6 : 4} className={revealed ? 'dot on' : 'dot'} />
                        {revealed && (
                          <text x={x} y={y - 12} className="stop-label">{c.place}</text>
                        )}
                      </g>
                    )
                  })}
                  <g ref={travelerRef}>
                    <circle r="20" className="traveler-pulse" />
                    <text className="traveler" textAnchor="middle" dy="0.36em">{ing.icon}</text>
                  </g>
                </g>
              </svg>
              {mapNote && <p className="map-note">{mapNote}</p>}
              <div className="timeline">
                <button className="play" onClick={() => {
                  if (!playing && cf.current >= n - 1) { cf.current = 0; activeRef.current = 0; setActiveIdx(0) }
                  setPlaying((p) => !p)
                }} aria-label={playing ? 'Pause' : 'Play'}>
                  {playing ? '❚❚' : '▶'}
                </button>
                <button className="step" onClick={() => goChapter(activeIdx - 1)} aria-label="Previous scene">‹</button>
                <button className="step" onClick={() => goChapter(activeIdx + 1)} aria-label="Next scene">›</button>
                <span className="year-read">{active.era}</span>
                <input
                  type="range" min={0} max={n - 1} step={1} value={activeIdx}
                  aria-label="Scenes"
                  onChange={(e) => { setPlaying(false); goChapter(Number(e.target.value)) }}
                />
                <div className="era-ticks">
                  {chapters.map((c, i) => (
                    <button key={c.place + i} className={i === activeIdx ? 'tick on' : 'tick'} onClick={() => goChapter(i)}>
                      {c.era}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <aside className="title-card">
              <p className="kicker">{ing.name} · Scene {activeIdx + 1} of {n} · {active.era}</p>
              <h2>{active.title}</h2>
              <p className="country-name">{active.place}, {active.country}</p>
              <p className="story">{active.story}</p>
              <p className="exam-fuel"><strong>Exam fuel:</strong> {active.exam}</p>
              <div className="scene-nav">
                <button onClick={() => goChapter(activeIdx - 1)} disabled={activeIdx === 0}>← Prev scene</button>
                <button onClick={() => goChapter(activeIdx + 1)} disabled={activeIdx === n - 1}>Next scene →</button>
              </div>
            </aside>
          </section>
          <p className="origin-line"><strong>Origin:</strong> {ing.origin}</p>
        </>
      )}

      {tab === 'cram' && <CramView ing={ing} goChapter={(i) => { setTab('film'); setTimeout(() => goChapter(i), 50) }} />}
      {tab === 'quiz' && <QuizView ing={ing} />}
      {tab === 'plate' && <PlateView ing={ing} meals={meals} onOpenMeal={onOpenMeal} />}
    </div>
  )
}

/* ---------------- cram sheet ---------------- */

function CramView({ ing, goChapter }) {
  return (
    <section className="cram">
      <h2>Cram sheet: {ing.name} {ing.icon}</h2>
      <p className="cram-origin">{ing.origin}</p>
      <ol className="cram-list">
        {ing.chapters.map((c, i) => (
          <li key={c.place + i}>
            <button className="cram-item" onClick={() => goChapter(i)}>
              <span className="cram-era">{c.era}</span>
              <span className="cram-fact">{c.exam}</span>
              <span className="cram-go">Watch scene →</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="cram-tip">Read each line, cover the right side, say it back. Five minutes, exam-ready.</p>
    </section>
  )
}

/* ---------------- quiz ---------------- */

function QuizView({ ing }) {
  const questions = useMemo(() => buildQuiz(ing), [ing.id])
  const [qi, setQi] = useState(0)
  const [picked, setPicked] = useState(null)
  const [score, setScore] = useState(0)
  const [done, setDone] = useState(false)

  const q = questions[qi]
  const answer = (opt) => {
    if (picked !== null) return
    setPicked(opt)
    if (opt === q.answer) setScore((s) => s + 1)
  }
  const next = () => {
    if (qi + 1 >= questions.length) setDone(true)
    else { setQi(qi + 1); setPicked(null) }
  }
  const restart = () => { setQi(0); setPicked(null); setScore(0); setDone(false) }

  if (done) {
    const verdict = score === questions.length ? 'Flawless. Teach the class.'
      : score >= 3 ? 'Solid. One more watch of the film and you are set.'
      : 'The film is right there. Watch it again, then retake.'
    return (
      <section className="quiz">
        <h2>Quiz complete</h2>
        <p className="quiz-score">{score} / {questions.length}</p>
        <p>{verdict}</p>
        <button className="show-all" onClick={restart}>Retake the quiz</button>
      </section>
    )
  }

  return (
    <section className="quiz">
      <h2>Quiz: {ing.name} {ing.icon}</h2>
      <p className="quiz-progress">Question {qi + 1} of {questions.length} · Score {score}</p>
      <p className="quiz-q">{q.q}</p>
      <div className="quiz-opts">
        {q.options.map((opt) => {
          let cls = 'quiz-opt'
          if (picked !== null) {
            if (opt === q.answer) cls += ' right'
            else if (opt === picked) cls += ' wrong'
          }
          return (
            <button key={opt} className={cls} onClick={() => answer(opt)} disabled={picked !== null}>
              {opt}
            </button>
          )
        })}
      </div>
      {picked !== null && (
        <div className="quiz-feedback">
          <p>{picked === q.answer ? 'Correct.' : `Not quite. The answer is: ${q.answer}.`}</p>
          <button className="show-all" onClick={next}>{qi + 1 >= questions.length ? 'See results' : 'Next question'}</button>
        </div>
      )}
    </section>
  )
}

/* ---------------- on the plate: dishes born from this journey ---------------- */

function PlateView({ ing, meals, onOpenMeal }) {
  const dishes = useMemo(() => dishesForIngredient(meals, ing), [meals, ing.id])
  return (
    <section className="plate">
      <h2>On the plate: what {ing.name.toLowerCase()} made possible</h2>
      <p className="plate-sub">
        Every dish below exists because of the journey you just watched. These come from a snapshot
        of {meals.length} online recipes, so the story runs deeper than the catalog.
      </p>
      {dishes.length === 0 ? (
        <p className="empty">No snapshot recipes matched this ingredient yet. The story still stands.</p>
      ) : (
        <div className="grid">
          {dishes.map((m) => (
            <button key={m.id} className="card" onClick={() => onOpenMeal(m)}>
              <img src={m.thumb} alt="" loading="lazy" />
              <span className="card-name">{m.name}</span>
              <span className="card-meta">{m.area} · {m.category}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

/* ---------------- home: the ingredient picker ---------------- */

function Home({ meta, onPick, onPantry }) {
  return (
    <div className="home">
      <section className="hero">
        <p className="hero-kicker">Recipe Atlas</p>
        <h1>Every ingredient has a movie.</h1>
        <p className="hero-sub">
          Follow fifteen ingredients across the world through history: the heists, the famines,
          the love affairs, the court cases. Built for the student cramming food history,
          the kid wondering why dinner tastes the way it does, and the teacher who wants
          the class to lean in.
        </p>
        <div className="hero-stats">
          <span><strong>{INGREDIENTS.length}</strong> ingredient films</span>
          <span><strong>{INGREDIENTS.reduce((a, i) => a + i.chapters.length, 0)}</strong> scenes</span>
          <span><strong>{meta.mealCount}</strong> recipes on the plate</span>
        </div>
      </section>
      <section className="ing-grid">
        {INGREDIENTS.map((ing) => (
          <button key={ing.id} className="ing-card" style={{ '--accent': ing.color }} onClick={() => onPick(ing.id)}>
            <span className="ing-icon">{ing.icon}</span>
            <span className="ing-name">{ing.name}</span>
            <span className="ing-tag">{ing.tagline}</span>
            <span className="ing-meta">{ing.chapters.length} scenes · starts {ing.chapters[0].place}</span>
            <span className="ing-play">▶ Play the film</span>
          </button>
        ))}
      </section>
      <section className="pantry-teaser">
        <h2>Just here to cook?</h2>
        <p>The pantry holds {meta.mealCount} searchable recipes from {meta.areas.length} cuisines. The films are the main event, though.</p>
        <button className="show-all" onClick={onPantry}>Open the pantry</button>
      </section>
    </div>
  )
}

/* ---------------- pantry: the recipe explorer ---------------- */

function Pantry({ meals, meta, initialArea, onOpenMeal }) {
  const [query, setQuery] = useState('')
  const [area, setArea] = useState(initialArea || 'All')
  const [showAll, setShowAll] = useState(false)
  useEffect(() => { if (initialArea) setArea(initialArea) }, [initialArea])

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
    <section className="explorer">
      <div className="explorer-head">
        <h2>The pantry</h2>
        <input
          type="search"
          placeholder={`Search ${meals.length} recipes, ingredients, cuisines…`}
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
            <button key={m.id} className="card" onClick={() => onOpenMeal(m)}>
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
  )
}

/* ---------------- meal modal ---------------- */

function MealModal({ meal, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  if (!meal) return null
  return (
    <div className="overlay" onClick={onClose}>
      <article className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Close">×</button>
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
  )
}

/* ---------------- app shell ---------------- */

export default function App() {
  const { bundle, error } = useBundle()
  const geo = useGeo(bundle)
  const [view, setView] = useState('home')
  const [ingredientId, setIngredientId] = useState('chili')
  const [meal, setMeal] = useState(null)
  const [pantryArea, setPantryArea] = useState(null)

  if (error) {
    return <div className="boot"><p>Could not load the atlas data: {error}</p></div>
  }
  if (!bundle || !geo) {
    return <div className="boot"><p>Loading the atlas…</p></div>
  }

  const { meals, meta } = bundle
  const ing = INGREDIENT_MAP[ingredientId] || INGREDIENTS[0]

  const goFilm = (id) => { setIngredientId(id); setView('film'); window.scrollTo(0, 0) }
  const goPantry = (area) => { setPantryArea(area || null); setView('pantry'); window.scrollTo(0, 0) }

  return (
    <div className="page">
      <header className="masthead">
        <button className="brand" onClick={() => { setView('home'); window.scrollTo(0, 0) }}>
          <span className="brand-icon">🌍</span>
          <span><strong>Recipe Atlas</strong><small>Every ingredient has a movie</small></span>
        </button>
        <nav className="topnav">
          <button className={view !== 'pantry' ? 'on' : ''} onClick={() => { setView('home'); window.scrollTo(0, 0) }}>Films</button>
          <button className={view === 'pantry' ? 'on' : ''} onClick={() => goPantry()}>Pantry</button>
        </nav>
      </header>

      {view === 'home' && <Home meta={meta} onPick={goFilm} onPantry={() => goPantry()} />}
      {view === 'film' && (
        <FilmView
          ing={ing}
          meals={meals}
          geo={geo}
          onBack={() => { setView('home'); window.scrollTo(0, 0) }}
          onOpenMeal={setMeal}
          onPantryArea={(a) => goPantry(a)}
        />
      )}
      {view === 'pantry' && (
        <Pantry meals={meals} meta={meta} initialArea={pantryArea} onOpenMeal={setMeal} />
      )}

      <footer>
        <p>Ingredient films are written from the historical record: origins, trade routes, and turning points. Dates before 1500 are approximate eras.</p>
        <p>Recipe snapshot: {meta.source}, pulled {meta.snapshotDate} by the ETL in this repo (etl/fetch_themealdb.py). Map: Natural Earth via world-atlas.</p>
      </footer>

      <MealModal meal={meal} onClose={() => setMeal(null)} />
    </div>
  )
}
