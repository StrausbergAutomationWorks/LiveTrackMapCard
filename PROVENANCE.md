# Provenance

This repository is a **clone of `nathan-gs/ha-map-card` at v1.16.0**, upstream
commit `7985260`, taken 2026-09-15. It is not a fork of it.

## Why a clone and not a fork

A GitHub fork carries a permanent *Contribute -> Open pull request* affordance
aimed at upstream, on every branch pushed. This repository exists to diverge,
and the single most damaging mistake available in this project is
pull-requesting to the wrong place. A fresh repository makes that impossible
rather than merely discouraged - the same reasoning that gives the `upstream`
remote in `flights_above` a push URL of `DO-NOT-PUSH-TO-UPSTREAM` instead of a
real URL.

Operationally this is an **original**: one branch, `main`, no pristine branch
to protect and no fetch discipline. Cherry-picking upstream fixes gets harder,
and that cost is accepted.

## What is owed, and what is not

The upstream licence is **MIT**, and MIT obliges **notice retention** -
`LICENSE` and its copyright notice travel with any copy or substantial portion
of the code. That file is unmodified and stays unmodified.

MIT does **not** oblige credit in a README, a UI or a listing. There is no
advertising clause and derivatives need not stay MIT. The notice is the
obligation; anything beyond it is courtesy, and this file is courtesy.

Do not confuse a code licence with a **data** source's attribution terms.
OpenRailwayMap tiles are CC-BY-SA 2.0 over ODbL data and bind whoever
*displays* them; that obligation is separate, lives in dashboard
configuration, and is not discharged by this file.

## Relationship to the upstream tracking fork

`StrausbergAutomationWorks/ha-map-card` remains a **tracking fork** with its own
purpose: carrying changes offered back to nathan-gs. Three are judged worth
sending - the rebuild-on-entity-list-change fix, the changed `entity_picture`
fix, and marker rotation by attribute. That work is unaffected by this
repository, and landing it upstream is still worth doing.

**Two repositories, two relationships.** The tracking fork is for the pull
request. This one is for what ships.

## The five local changes are NOT in this tree yet

What runs on the instance today is the **built bundle** with five patches
applied to it by script, not to source:

1. `position_transition` - optional marker movement, seconds or `auto`
2. module-level view memory on `moveend` - superseded in effect, never to be sent
3. no rebuild when only the entity list changed - the real bug
4. a changed `entity_picture` reaches an existing marker - the second real bug
5. `rotation_attribute` / `rotation_transition`

Patching a rollup bundle is a workaround for not holding the source. Holding it
now, the patches should be **ported into `src/` and built**, and the bundle
patch scripts retired to reference. Each script in
`35_Dependencies/third_party/ha-map-card/10_Reference/` documents exactly what
its change does, which is the specification for the port.

**Until that port is done, the installed card and this tree are NOT the same
code.** The tree is pristine 1.16.0; the box runs 1.16.0 plus five patches.

## Why this exists at all

The integrations are not going to depend on a card a stranger may not have
installed. The installed card is already a private divergent copy that nobody
outside this machine can obtain, so formalising it changes who else can run it,
not what runs here.

Intended shape: two tabs. One holds the small per-integration cards for
whichever Live Track integrations the user installed; the other is a panel map
showing every integration's objects.

## Identity — changed 2026-09-15

The clone now has its own identity. Four separate things, all of which had to
change together:

| | was | is |
|---|---|---|
| npm package | `ha-map-card` | `live-track-map-card` |
| version | `1.16.0` | `0.1.0` |
| HACS name / filename | `map-card` / `map-card.js` | `Live Track Map Card` / `live-track-map-card.js` |
| custom elements | `map-card`, `map-card-entity-marker` | `live-track-map-card`, `live-track-map-card-entity-marker` |
| card-picker type | `map-card` | `live-track-map-card` |
| rollup output | `dist/map-card.js` | `dist/live-track-map-card.js` |

Version restarts at `0.1.0` rather than continuing from `1.16.0`, so that our
`1.17.0` and nathan's `1.17.0` can never be two different things wearing one
number.

### Why the element rename is load-bearing

`src/index.js` guards registration:

    if (!customElements.get("map-card")) { ... }

Two copies claiming that name do **not** throw. The second simply does not
register — no error, no console banner — and every `type: custom:map-card` in
a dashboard renders whichever module loaded first. With HACS's `ha-map-card`
installed alongside, ours could load, register nothing, and leave the map
looking as though our patches had regressed, with nothing in the log. A crash
would have been kinder. Distinct names are what let both be installed at once
during the transition.

Existing dashboard cards still say `type: custom:map-card` and therefore still
point at the HACS card. That is intended: they move over one at a time.

### ⚠ A trap for whoever ports the patches

`patch_marker_rotation.py` and `patch_picture_refresh.py` reach for the marker
element by name:

    querySelector("map-card-entity-marker")

Measured: **0 occurrences in pristine 1.16.0, 2 in our patched bundle**, and
four references across the two patch scripts. Those calls are OURS, not
upstream's. Ported verbatim they would query an element this card no longer
defines — returning null, doing nothing, reporting nothing. They must be
ported as `live-track-map-card-entity-marker`.
