# Live Track Map Card

A Leaflet map card for Home Assistant, and the shared map of the Live Track
integrations: aircraft, ships, trains and weather on one map.

It is derived from [ha-map-card](https://github.com/nathan-gs/ha-map-card)
1.16.0 by [nathan-gs](https://github.com/nathan-gs), under the MIT licence.
The options documented below are mostly his, and the Live Track features are
built on his card. This is a separate card with its own name,
`custom:live-track-map-card`, so it can be installed alongside ha-map-card
(`custom:map-card`) without either replacing the other.

### Installation

#### HACS

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=StrausbergAutomationWorks&repository=LiveTrackMapCard&category=plugin)

#### Manual
1. Get `live-track-map-card.js`: download it from a release's assets, or build
   it from this repository with `npm ci` and then `npm run build`, which writes
   `dist/live-track-map-card.js`.
2. Copy it to `/config/www/live-track-map-card/live-track-map-card.js`.
3. Add it as a resource: **Settings → Dashboards → ⋮ → Resources → Add
   resource** (the menu needs Advanced mode, set in your user profile). URL
   `/local/live-track-map-card/live-track-map-card.js?v=1`, type
   **JavaScript module**.
4. Whenever you replace the file, change the `?v=` value as well (`?v=2`, and
   so on). Browsers cache a resource by its URL for up to 31 days, so a new file
   behind an unchanged URL can keep loading the old one.

### Live Track

Each Live Track integration publishes what it tracks as `geo_location`
entities, and every one of them carries a `source` attribute naming the
integration (`live_track_aircraft`, `live_track_ships`, and so on). The shared
map is this card inside [auto-entities](https://github.com/thomasloven/lovelace-auto-entities),
which hands the card every entity matching a filter. A new train or vessel then
appears on the map, and leaves it, without the card being edited.

One integration:

```yaml
type: custom:auto-entities
card_param: entities
card:
  type: custom:live-track-map-card
  x: 41.88       # latitude
  y: -87.63      # longitude
  zoom: 10
filter:
  include:
    - domain: geo_location
      attributes:
        source: live_track_ships
      options:
        display: attribute
        attribute: marker_label
        position_transition: auto
  exclude:
    - state: unavailable
```

Every Live Track integration at once, by leaving `source` out. That matches
every `geo_location` entity on the instance, so exclude other integrations'
by their own `source` (here `geo_json_events`):

```yaml
filter:
  include:
    - domain: geo_location
      options:
        display: attribute
        attribute: marker_label
        position_transition: auto
  exclude:
    - attributes:
        source: geo_json_events
    - state: unavailable
```

`card_param: entities` is required: it is what tells auto-entities which of
the card's options to fill. Whatever goes under `options:` is applied to every
entity the filter finds. `display: attribute` with `attribute: marker_label`
draws the label the integration chose (a train or flight number) instead of
one squeezed out of the entity's name. `position_transition: auto` slides each
marker to its new position over the time since its last update, at most 30
seconds, and not at all when the browser asks for reduced motion.

#### Without auto-entities: `entity_filter`

The card can pick its own entities. `entity_filter` takes auto-entities'
`include` and `exclude` lists as they are, so moving a dashboard over is a
matter of putting its `filter:` block under the card as `entity_filter:` and
dropping the auto-entities wrapper:

```yaml
type: custom:live-track-map-card
x: 41.88
y: -87.63
zoom: 10
entity_filter:
  include:
    - attributes:
        source: live_track_aircraft
      options:
        size: 60
        color: transparent
        rotation_attribute: icon_rotation_deg
    - domain: geo_location
      options:
        display: attribute
        attribute: marker_label
        position_transition: auto
    - domain: person
    - domain: device_tracker
      has_position: true
      away_from_person_m: 100
  exclude:
    - state: unavailable
```

* Each entity takes the **first** `include` rule it matches, with that rule's
  `options`. Every key in a rule must match. An entity any `exclude` rule
  matches is left out.
* Rule keys: `domain`, `entity_id`, `state`, `attributes` (each value), `not`
  (a rule that must NOT match) and `options`. Values match as text: exactly,
  with `*` as a wildcard, or as a `/regex/`. A missing attribute matches nothing.
* Two keys of the card's own: `has_position: true` needs numeric `latitude` and
  `longitude`; `away_from_person_m: 100` leaves out a device tracker while it is
  within 100 m of a person who lists it in `device_trackers` (that person's own
  marker already covers it).
* Any other key (auto-entities' `area`, `label`, `sort` and so on) is refused
  with an error naming it, so a filter never silently does less than written.
* No sort. The map stacks markers by layer and position, never by list order.
* `entities:` still works beside it; an entity listed there keeps its own
  options.

The card looks at an entity again only when its state changed, and updates its
markers only when an entity arrives, leaves or moves to another rule, so a map
of a few thousand moving objects costs a few milliseconds per update.

A marker whose entity carries `marker_info`, `{"title": ..., "text": ...}` in plain
text (a forecast point from Live Track Weather, say), opens that text in a popup
when clicked, instead of the entity's dialog. Nothing in it is read as HTML.

A marker can also carry a photo, `marker_photo`, and links out, `marker_links`
(Live Track Ships sends a vessel's photo from Wikimedia Commons and a link to
the vessel on VesselFinder). The photo appears in the hover box with its credit.
A click opens a popup with the vessel's name, the photo, the photographer and
licence (each linked to its page), the links, and a **Details** button that
opens the entity's dialog. A photo is drawn only with its credit, only https
addresses are used, and the browser sends no referrer when loading it.

```yaml
marker_photo:
  url: https://upload.wikimedia.org/.../330px-Example.jpg   # the thumbnail
  page: https://commons.wikimedia.org/wiki/File:Example.jpg # the photo's own page
  credit: Photographer
  licence: CC BY-SA 4.0          # optional
  licence_url: https://creativecommons.org/licenses/by-sa/4.0   # optional
  source: Wikimedia Commons      # optional
  width: 320                     # optional, keeps the proportions while loading
  height: 240
marker_links:                    # up to four
  - label: VesselFinder
    url: https://www.vesselfinder.com/vessels/details/9606900
```

### Usage

> #### TIP
>
> Home Assistant contains a [native map](https://www.home-assistant.io/dashboards/map/) feature, if you don't need advanced features like WMS layers it might be a better choice.

#### Minimal
```yaml
type: custom:live-track-map-card
x: 51.23
y: 3.652
```

#### More advanced

> ##### TIP
>
> Take a look at:
> https://nathan.gs/2024/01/06/ha-map-card-a-new-and-alternative-leaflet-based-map/#a-more-advanced-example-measuring-pm25-air-quality-for-my-home
>
> It was written for ha-map-card: to use its examples with this card, change
> `type: custom:map-card` to `type: custom:live-track-map-card`.

### Options

| name                     | Default                                                                                                                      | note                                         |
|--------------------------|------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------|
| `x`                      |                                                                                                                              | Latitude                                     |
| `y`                      |                                                                                                                              | Longitude                                    |
| `history_start`          |                                       																						  | Date: `2022-03-01T12:00:00Z` <br/>Time code: `5 hours ago` <br/>Entity: `input_number.example_number`  <br/>See [History options](#history-options) for full details.  |
| `history_end`            | `now`                                 																						  | Date: `2022-03-01T12:00:00Z` <br/>Time code: `5 hours ago` <br/>Entity: `input_number.example_number`  <br/>See [History options](#history-options) for full details. |
| `focus_entity`           |                                                                                                                              | Entity to focus on. Map will default to show all markers if this and X/Y are not set.        |
| `title`                  |                                                                                                                              | If empty, don't show a title                 |
| `zoom`                   | 12                                                                                                                           | The zoom level. Ignored unless focus_entity or X & Y coords are set.                               |
| `card_size`              | 5                                                                                                                            | The Home Assistant card size                 |
| `entities`               | []                                                                                                                           | Array of entities, will be listed as markers |
| `wms`                    | []                                                                                                                           | WMS Layers, an array of `WMS` see below      |
| `tile_layers`            | []                                                                                                                           | Tile Layers, an array of `Tile Layers` see below      |
| `tile_layer_url`         | https://tile.openstreetmap.org/{z}/{x}/{y}.png or `https://tile.example.com/{{states('sensor.test') }}/{z}/{x}/{y}.png`      | Override the default map source, the url supports entity lookups. See [URL Entity lookup](#url-entity-lookup).            |
| `tile_layer_attribution` | &amp;copy; &lt;a href&#x3D;&quot;http:&#x2F;&#x2F;www.openstreetmap.org&#x2F;copyright&quot;&gt;OpenStreetMap&lt;&#x2F;a&gt; | Set the correct map attribution              |
| `tile_layer_options` | {}                                                                                                                               | The `options` for the default [TileLayer](https://leafletjs.com/reference.html#tilelayer) |
| `history_date_selection` | false                                                                                                                        | Will link with a `energy-date-selection` on the page to provide an interactive  date range picker. |
| `theme_mode`          | auto                                  | `auto`, `light` or`dark`                                                                      |
| `focus_follow`        | none                                  | `none`, `refocus`, `contains`, reset the map focused entity's, on each update. Some people call this the `Autofit` feature.                                                              |
| `focus_follow_pause`  | 0                                     | Number of seconds to suspend `focus_follow` after the user pans (mouse down/drag) or zooms the map. `0` disables pausing (default, existing behavior).                                  |
| `map_options`          | {}                                                                                                                           | The `options` for the default [Leaflet Map](https://leafletjs.com/reference.html#map) |
| `cluster_markers`      | false                                                                                                                        | Enable marker clustering to group nearby entities together. Click the group icon button to toggle clustering on/off. |
| `canvas_markers`       | true                                                                                                                         | Plain markers (a picture in its disc, or a disc with only its label and arrow) are drawn on a canvas, one per stacking class, instead of one page element each, so a map with hundreds of markers stays smooth. Animated pictures, rings, badges, stars and other special shapes stay page elements, and a canvas marker under the pointer becomes its page element while hovered. `false` draws every marker as a page element. Not used with `cluster_markers`. |
| `path_following`       | true                                                                                                                         | Boats slide along the water instead of in a straight line across land. See [Path-following](#path-following). `false` turns it off. |
| `path_min_zoom`        | 14                                                                                                                           | Path-following works from this zoom up. Below it a slide is straight, as without the feature. |
| `path_strict_zoom`     | 14                                                                                                                           | From this zoom a boat is never slid on a move the card has not checked: while the water tiles for a move are still loading, the boat is placed at its new position instead of sliding straight. |
| `path_tile_sources`    | OpenStreetMap, then OpenFreeMap                                                                                              | The vector tile sources the water comes from, tried in order. See [Path-following](#path-following). |
| `shape_layers`         | auto                                                                                                                         | Filled areas published by an integration, such as weather alerts. See [Shapes on the map](#shapes-on-the-map). `false` turns them off. |
| `shape_style`          | fill 0.25, outline 2 px at 0.9; lines from a shape file 1 px at 0.5                                                          | How those areas are drawn. See [Shapes on the map](#shapes-on-the-map). |
| `point_layers`         | auto | Points published by an integration as one file, such as fire detections. See [Points on the map](#points-on-the-map). `false` turns them off. |
| `weather_radar`        | on, ticked                                                                                                                   | The weather radar overlay. See [Weather radar](#weather-radar). `false` removes it. |
| `layer_control`        | true | `false` removes the checkboxes. Every overlay stays as configured, and a choice a viewer stored earlier is ignored. |
| `layer_control_collapsed` | true | The checkboxes fold behind the layers icon at the top right; a tap (or hovering, with a mouse) opens them. `false` keeps them always open. |
| `presence_markers` | true | People, devices and zones drawn as Home Assistant's own map draws them: every non-passive zone, picture pins, everyone in a zone in one bubble above it. See [People, devices and zones](#people-devices-and-zones). `false` keeps the older markers. |
| `overview` | (panel views) | The People / Devices / Zones panel beside the map, as Home Assistant's own map card shows it. Unset: shown when the card fills a panel view. `true` shows it anywhere, `false` never. See [The overview](#the-overview). |
| `attribution_collapse` | true | The credits box opens in full with the map, then collapses behind an **i** button after 5 seconds or at the viewer's first press, scroll or key on the map (OpenStreetMap's attribution guideline allows both). The button reopens it, at most 40% of the map's height and scrollable. `false` keeps the box always open. |
| `weather_area`         | none | `{latitude, longitude, radius_km}`. Shapes are drawn only where they touch this circle, and weather radar tiles only inside the box around it. |
| `lightning`            | on, unticked                                                                                                                 | The lightning overlay. See [Lightning](#lightning). `false` removes it. |
| `debug` | false                                                                                                                        | Enable debug messages in console.
| `plugins`            | []                                                                                                                           | An array of plugin definitions, see: [Plugin Options](#plugin-options), [Available plugins](#available-plugins) and [Developing plugins](#developing-plugins)     |

For non-geographic maps, set `map_options.crs` to `simple`. The card will translate that into Leaflet's `L.CRS.Simple`, so you can use image/floor-plan style coordinates and pair them with entity `fixed_x` / `fixed_y` values.

```yaml
type: custom:live-track-map-card
x: 0
y: 0
zoom: 0
map_options:
  crs: simple
  minZoom: -5
tile_layer_url: ""
entities:
  - entity: sensor.room_temperature
    fixed_x: 320
    fixed_y: 180
```


If `x` & `y` or `focus_entity` is not set it will take the lat/long from the __first entity__.

### Path-following

When an entity slides from its previous position to a new one (`position_transition`), a straight line can cross land: a boat between two fixes on a winding river cuts across the bank, through buildings and over piers. With path-following the card slides it along the water instead, and a boat whose reported position sits on land (a mooring against a seawall, a GPS or map error) is drawn in the nearest water.

* **What follows paths:** entities with `map_layer: water`. Nothing else changes.
* **When:** from `path_min_zoom` (14) up, where a crossing is big enough to see. Below it every slide is straight. From `path_strict_zoom` (14) a move whose water tiles have not arrived yet is placed, not slid.
* **What the card fetches:** vector map tiles at zoom 14, only for moving boats on screen, kept in the browser for 7 days. Nothing is fetched ahead of viewing.
* **Sources, in order:** [OpenStreetMap's vector tiles](https://vector.openstreetmap.org/) (Shortbread schema), then [OpenFreeMap](https://openfreemap.org/) (OpenMapTiles schema) if the first fails. An HTTP 429 from either stops all tile fetching for that page; if both fail, slides are straight. The attribution of a source is added to the map once its data has been used.
* **What it does not do:** it never changes the entity's state or what the recorder stores, and it never slides a boat across land: a move that cannot be routed over water (no way round, or a route more than twice the straight line) places the boat at its new position instead. Piers and breakwaters are never crossed.

Both tile services are run on donated or volunteer infrastructure; please keep their terms in mind ([OpenStreetMap vector tile policy](https://operations.osmfoundation.org/policies/vector/), [OpenFreeMap](https://openfreemap.org/)).

```yaml
path_following: true        # the default; false turns it off
path_min_zoom: 14
path_strict_zoom: 14
path_tile_sources:          # optional; replaces the list
  - id: my-tiles
    tiles: https://tiles.example.com/{z}/{x}/{y}.pbf
    schema: openmaptiles    # or shortbread
    attribution: '&copy; Example, data &copy; OpenStreetMap contributors'
```

### Shapes on the map

Some integrations publish areas rather than points: weather alerts by forecast zone and county, for example. The card finds any entity that publishes them (a `shapes_url` naming a file of shapes, and `zones` naming which to fill now, each with an event), fetches that file once, and fills each area in its event's colour over the map and under every marker. The most important event is drawn on top. Each publisher gets a checkbox in the layer control at the top right, on by default; a viewer's own choice is kept in their browser. The checkbox is labelled with the entity's name without its device's name ("US alerts", not "Live Track Weather US alerts"), unless you give it your own `name`; points (below) are labelled the same way. The publisher's credit appears in the map's attribution line while its areas are shown.

* **The file** is fetched from your Home Assistant and kept in memory for the page, never in browser storage. A new file has a new address, so an update is fetched once and the old one dropped.
* **If the file cannot be loaded**, only the areas the publisher sends with their own outline are drawn, and the card tries again after 10 minutes.
* **If the publisher is unavailable**, nothing is drawn for it.
* **Several publishers** are stacked by each one's `shape_order` (an integer, 0 when absent): a lower one is drawn beneath, ties by entity id, and the order holds through updates and when a box is ticked again.
* **Lines** (a storm's track, for example) are drawn in their event's colour with no fill. An event's style may name a `casing` colour, drawn 1 px either side beneath the line so it reads on any map.
* **Clickable shapes:** an item of `polygons` may carry `info`, `{"title": ..., "text": ...}` in plain text. That shape is clickable and opens a popup with the title in bold and the text's lines (at most 200 and 4,000 characters; nothing in it is read as HTML). Every other shape stays non-interactive, so clicks pass to the map.
* **The file may hold lines too** (submarine cables, for example), and an `info` mapping beside its shapes, `{key: {"title": ..., "text": ...}}`, which makes those keys clickable in the same way. Lines from the file are reference, so they are drawn thin and faint (1 px at 0.5, `file_line_weight` and `file_line_opacity` below) beneath anything drawn at the outline's weight. A clickable line answers a tap anywhere within 6 px of it, so a thin line can still be hit with a finger.
* **Off until ticked:** a publisher may ask for its box to start unticked (`layer_default: "off"`), for a layer that is reference rather than news. Your dashboard's `show` overrides that, and a viewer's own choice overrides both.

```yaml
shape_layers: auto          # the default: every publisher found
# shape_layers: false       # none
# shape_layers:             # exactly these, with your own label
#   - entity: sensor.my_alerts
#     name: Warnings
#     show: false           # start unticked
shape_style:                # optional; each key optional
  fill_opacity: 0.25
  weight: 2                 # outline, px
  opacity: 0.9              # outline
  renderer: svg             # or canvas
  by_priority: false        # true: stronger fill for more important events
  file_line_weight: 1       # lines from a shape file, px
  file_line_opacity: 0.5    # lines from a shape file
```

### Points on the map

Some integrations publish thousands of points that are not worth an entity each: satellite fire detections, or air-quality monitors, for example. The card finds any entity that publishes them (a `points_url` under `/api/` naming a file of points, and `point_styles` saying how each kind looks), fetches the file once with your sign-in, and draws the points as small dots on one canvas per publisher, above the shapes and below every marker. Each publisher gets a checkbox in the layer control, on by default unless the publisher asks for it to start unticked (`layer_default: "off"`, as for shapes).

* **Only what is on screen is drawn**, and where several dots would land within one dot of each other only the first is drawn, so a whole continent of points costs about as much as a handful. The dots are redrawn when the map stops moving.
* **Click a dot** for a popup: the kind of point in bold, then each value the file gives for it. The pointer becomes a hand over a dot. Dots never take clicks from markers, but they answer before a clickable shape drawn beneath them (a landing point on a cable line, for example).
* **A new file has a new address**, so an update is fetched once. If it cannot be loaded, nothing is drawn for that publisher and the card tries again after 10 minutes.
* **Several publishers** are stacked by each one's `point_order` (an integer, 0 when absent): a higher one is drawn on top and answers a click first.
* **`weather_area`** limits the dots to its circle, as it does shapes.

```yaml
point_layers: auto          # the default: every publisher found
# point_layers: false       # none
# point_layers:             # exactly these, with your own label
#   - entity: sensor.live_track_weather_fire_detections
#     name: Fires
#     show: false           # start unticked
```

### Weather radar

One radar layer with a checkbox, "Weather radar", in the layer control, on by default. For each map tile the card uses the sharpest radar that covers the whole tile, and [RainViewer](https://www.rainviewer.com/) everywhere else. Only the newest frame is shown; it is refreshed every few minutes while the box is ticked and the layer is on screen. The radar sits over the map tiles and under filled areas and every marker, and is not darkened by the dark theme.

| Where | Source | Licence / terms |
|---|---|---|
| North America, inside its published box (170.3°W–50°W, 16.9°N–67.2°N) | [Environment and Climate Change Canada GeoMet](https://eccc-msc.github.io/open-data/) | Open Government Licence – Canada |
| Guam, the Aleutians from 176°W to 170.3°W, the Caribbean south of 16.9°N | [NOAA nowCOAST](https://nowcoast.noaa.gov/) | no access constraints or fees (its capabilities) |
| Finland | [Finnish Meteorological Institute](https://en.ilmatieteenlaitos.fi/open-data) | CC BY 4.0 |
| Germany | [Deutscher Wetterdienst](https://www.dwd.de/) | CC BY 4.0 |
| Japan | [Japan Meteorological Agency](https://www.jma.go.jp/) | Public Data License 1.0 |
| everywhere else | [RainViewer](https://www.rainviewer.com/) (to zoom 7, enlarged beyond) | free for personal use, credit required |

* **Credits:** each source's credit appears in the map's attribution line while one of its tiles is on screen.
* **When a source is down** or its newest frame is over 30 minutes old, its tiles fall to the next source; if RainViewer's is too, no radar is drawn.
* **Relays:** an integration may offer a radar it fetches on your behalf (one that needs your own key). The card finds it by its `radar_relay` attribute and loads its tiles through a signed Home Assistant address. Nothing needs configuring.
* **No radar is stored** in the browser beyond its normal image cache; only the viewer's checkbox choice is kept, as for the other overlays. Requests go only to the sources on screen.

```yaml
weather_radar: true         # the default
# weather_radar: false      # no radar, no checkbox, no requests
# weather_radar:            # each key optional
#   opacity: 0.5
#   show: false             # start unticked
#   rainviewer_scheme: 2    # RainViewer colour scheme, 0-8
#   sources: [rainviewer]   # only these, in this order (fmi, dwd, jma, geomet, nowcoast, rainviewer, or a relay's id)
```

### Lightning

One layer with a checkbox, "Lightning", in the layer control, unticked by default (nothing is fetched until it is ticked): [NOAA nowCOAST](https://nowcoast.noaa.gov/)'s lightning strike density, 15-minute frames from the US National Lightning Detection Network and the Global Lightning Detection Network (GLD360), from 25°S to 80°N at every longitude. No key, no account. Only the newest frame is shown, also while the radar is in motion; a new frame is listed about 8 minutes after its time and is read every 5 minutes while the box is ticked. It sits right above the radar and under filled areas and every marker, with a thin dark ring round each strike cell so the palest densities show on a light map. Tiles are requested to zoom 8 and enlarged beyond (the data are an 8 km grid).

* **Credit:** "Lightning: NOAA nowCOAST" in the attribution line while it is drawn and the map shows part of the covered band.
* **When it is down** or its newest frame is over 45 minutes old, no lightning is drawn; the last frame stays while one read fails.
* Requests go only to nowCOAST, and only for tiles inside the covered band.

```yaml
lightning: true             # the default
# lightning: false          # no lightning, no checkbox, no requests
# lightning:                # each key optional
#   opacity: 0.6
#   show: true              # start ticked
#   outline: false          # no dark ring round the strike cells
```

### Clouds

One layer with a checkbox, "Clouds", in the layer control, unticked by default (nothing is fetched until it is ticked): infrared satellite pictures. Where GOES covers (the United States, Mexico, the Gulf of Mexico, the Caribbean north of 11°N and Hawaii) the picture is GOES's from [NOAA nowCOAST](https://nowcoast.noaa.gov/), a new one every 5 minutes. Everywhere else it is [EUMETSAT](https://view.eumetsat.int/)'s: Meteosat Third Generation every 10 minutes from 51°W to 45°E (Europe, Africa, the Atlantic), Meteosat over the Indian Ocean every 15 minutes from 45°E to 100°E, and EUMETSAT's 3-hourly world cloud map elsewhere (East Asia, the Pacific) and under the other two. North they reach about 77°N, and the world map up to 81°N in places; south they stop at 72.74°S, where Antarctica's ice would read as cloud. Each picture's greys are matched to GOES's, so the same cloud looks the same on either side of a join. No key, no account. Clear sky is left transparent and cloud is drawn by how cold its top is, at most 65% opaque: light grey on a light map, white on a dark one. The clouds sit right above the map tiles and under the radar, lightning, filled areas and every marker. Infrared shows very cold ground (the Arctic in winter, say) as cloud. Tiles are requested to zoom 6 and enlarged beyond.

* **Credit:** "Clouds: NOAA nowCOAST, GOES" while GOES's clouds can be on screen, and "Clouds: © EUMETSAT" while EUMETSAT's can.
* **When a picture is down** or too old (GOES over 30 minutes, MTG over 40, the Indian Ocean picture over 45, the world map over 7 hours), the next one down draws its area; when all are too old, no clouds are drawn.
* Requests go only to nowCOAST and EUMETSAT, and only for tiles a picture covers.

```yaml
clouds: true                # the default: offered, unticked
# clouds: false             # no clouds, no checkbox, no requests
# clouds:                   # each key optional
#   opacity: 0.8
#   show: true               # start ticked
```

### The filter card

A second card in the same file, `custom:live-track-map-filter-card`, hides groups of markers on the map: vessel types, for example. Put it anywhere on the dashboard, on another view if you like; it does not need to be beside the map. It lists every group the integrations publish (an integration names a marker's group in `marker_group`; Live Track Ships does, in thirteen groups), with how many of each are on the map now, under the integration's name, with **Show all** and **Hide all** for each.

* **Your choice is kept in this browser only.** Each person and device keeps their own; nothing is saved in Home Assistant. Every map card in the same browser follows it, at once, even on another view.
* A hidden group stays listed, with 0, while nothing of it is on the map, so it can be shown again.
* Hiding is drawing only: the integration still publishes everything, its sensors still count everything, and its events still fire. A marker with no `marker_group` is never hidden. Live Track Ships gives a distress beacon no group, so no class can hide one.

```yaml
type: custom:live-track-map-filter-card
title: Show on the map           # the default
# sources: [live_track_ships]    # only these integrations
# start_hidden:                  # hidden in a browser that has never made a choice
#   - live_track_ships:pleasure
```

### URL Entity lookup

You can add dynamic url's, for example to use a sensor value in the url. When the parameter changes, the map will redraw with the new tile layer.
```
tile_layer_url: https://tile.example.com/{{states('sensor.test') }}/{z}/{x}/{y}.png
```

> ##### TIP
>
> It only supports `states` without any filters, this is a crude javascript regex based implementation, not the Jinja2 templating engine from Home Assistant.


### Entity options

Either the name of the `entity` or:
| name                   | Default                               | note                                                                                          |
|------------------------|---------------------------------------|-----------------------------------------------------------------------------------------------|
| `entity`               |                                       | The entity id                                                                                 |
| `display`              | `marker`                              | `icon`, `state`, `attribute` or `marker`. <br/>`marker` will display the picture if available. <br/>`icon` will display the icon if available, otherwise a label composed of first letters of the entity's name. <br/>A `person`, `device_tracker` or `zone` with `marker` (or no `display`) is drawn as Home Assistant draws it; see [People, devices and zones](#people-devices-and-zones). `pill`, the former place pill, now means the same. |
| `picture`              |                                       | Set a custom picture to use on the marker.                                                    |
| `icon`                 |                                       | Set a custom icon to use if `display` is set to `icon`. e.g. `mdi:cake`                           |
| `label`                |                                       | Set a custom text label to display on the marker (overrides auto-generated initials). On picture markers, `label` / `prefix` / `suffix` overlay the photo; auto-generated initials do not. |
| `attribute`            |                                       | Set an attribute to use if `display` is set to `attribute`. e.g. `speed`                |
| `prefix`            |                                       | Optional prefix for a value if `display` is set to `attribute`                |
| `suffix`            |                                       | Optional suffix for a value if `display` is set to `attribute`                |
| `size`                 | 48                                    | Size of the icon                                                                              |
| `color`                | Random Color                          | Can defined as `red`, `rgb(255,0,0)`, `rgba(255,0,0,0.1)`, `#ff0000`, `var(--red-color)`      |
| `css`                  | `text-align: center; font-size: 60%;` | CSS for the marker (only for `state` and `marker`)                                            |
| `history_start`        |                                       | Will inherit from map config if not set. <br/>Date: `2022-03-01T12:00:00Z` <br/>Time code: `5 hours ago` <br/>Entity: `input_number.example_number`  <br/>See [History options](#history-options) for full details. |
| `history_end`          | `now`                                 | Will inherit from map config if not set. <br/>Date: `2022-03-01T12:00:00Z` <br/>Time code: `5 hours ago` <br/>Entity: `input_number.example_number`  <br/>See [History options](#history-options) for full details. |
| `history_line_color`   | Random Color                          | Can defined as `red`, `rgb(255,0,0)`, `rgba(255,0,0,0.1)`, `#ff0000`, `var(--red-color)`      |
| `history_show_lines`   | true                                  | Show the path                                                                                 |
| `history_show_dots`    | true                                  | Show little dots on the path                                                                  |
| `fixed_x`              |                                       | Display a fixed marker, this will ignore the latitude/longitude attributes                    |
| `fixed_y`              |                                       | Display a fixed marker, this will ignore the latitude/longitude attributes                    |
| `fallback_x`           |                                       | If the latitude/longitude is missing, use these fixed attributes                              |
| `fallback_y`           |                                       | If the latitude/longitude is missing, use these fixed attributes                              |
| `tap_action`           | {"action": "more-info"}               | Allow custom action to be triggered when this entity is clicked. Actions include `more-info`, `call-service`, `navigate`, `url`, `assist`, `none`. Some actions require additional paramaters. `navigate` requires a `navigation_path`. `url` requires a `url_path`. `call-service` requires `service` and an optional `data`|
| `gradual_opacity`      |                                       | The total amount of opacity will be gradually distributed across the paths. `gradual_opacity` is divided by the number of paths to calculate the opacity step for each path. The base opacity is generated by (1 - `gradual_opacity`), and as each path progresses, its opacity gradually darkens by the step amount.|
| `focus_on_fit`         | true                                  | If this variable is set to false, This entity will be excluded when the map fits the included entities on the screen.|
| `z_index_offset`       | 1                                     | z-index value that determines what is displayed on top when markers overlap. (Setting a gap of at least 20 between the values assigned to each entity is recommended.) |
| `use_base_entity_only` | false                                 | When set to `true`, the tracking will use only the base entity without including any associated device trackers. This is useful for scenarios where you want to track the base entity directly and ignore any associated trackers. |
| `position_update_threshold` | 10                               | Distance threshold in meters. Marker position only updates if the entity has moved more than this distance. Prevents unnecessary map updates from GPS drift. Useful for clustered markers. |
| `circle`               |                                       | Display a circle around the marker. <br/>More details [Circle options](#circle-options) |
| `geojson`              |                                       | Display GeoJSON data from an entity attribute. <br/>More details [GeoJSON options](#geojson-options) |

### People, devices and zones

Since 2026-11 (`presence_markers`, on by default) the card draws a `person`, a
`device_tracker` and every zone the way Home Assistant's own map has drawn them since
2026.10:

- **Zones.** Every zone that is not passive is drawn, whether or not the dashboard lists
  it: a 36 px coloured circle with the zone's icon (or its initials), and the zone's
  radius as a circle in the same colour. Home is the theme's primary colour; every other
  zone takes the same colour Home Assistant gives it, read from the entity registry (the
  order zones were created in) and the theme's palette. A passive zone is not drawn.
- **People and devices.** A framed picture on a small pin; without a picture, the first
  letters of its name. A pin shows its GPS accuracy as a circle in its own colour.
- **Everyone in a zone shares one bubble** floating above the zone's circle, a lone
  occupant included. Who is in a zone comes from Home Assistant's `in_zones` (the first
  active zone), else from the position: the smallest zone that contains it.
- **Crowds merge.** Members of one zone share its bubble while they are within 160 px of
  each other on screen; anyone else merges with markers within 40 px; bubbles that would
  overlap merge. A bubble shows up to four pictures, the fourth slot becoming "+N".
- **A tap on a bubble** zooms to its members; once zooming in could not part them (or at
  the maximum zoom) the bubble opens, and each picture in it opens that entity's details.
  A tap on a pin opens its details.

Only these three kinds change: every other entity is drawn exactly as before. A person
or tracker given another `display:` (`icon`, `state`, `attribute`) keeps the older
marker. `display: pill`, the former place pill, now means the new look.
`presence_markers: false` turns all of it off.

#### The overview

When the card fills a **panel view** (also inside a wrapper such as auto-entities), it
shows the panel Home Assistant's own map card shows there: tabs **People**, **Devices**
and **Zones**, a row for each with its state and how long ago, and the count of people in
each zone. On a screen 600 px wide or narrower the panel is a bottom sheet you drag
between collapsed, half and full height.

- **Tabs filter the map.** People hides device markers, Devices hides people; zones and
  every other entity stay.
- **Selecting** a row, or tapping a person, device or zone on the map, brings it into
  view (zoomed in only as far as it takes to stand clear of its neighbours), shows its
  picture larger with its accuracy circle, and lists its last 24 hours: a person's or
  device's state changes, or who entered and left a zone. The panel also offers
  directions and, for administrators, the entity's settings. The selection is kept in the
  page address (`?entity_id=`), so the browser's back button clears it; a tap on the map
  clears it too.
- With the panel shown, accuracy circles are drawn only for the selection, and a zone's
  radius only when that zone is selected or on the Zones tab.

`overview: true` shows the panel outside a panel view; `overview: false` never shows it.
Activity needs Home Assistant's `history` integration (on by default).

The design and its constants follow Home Assistant's frontend (Apache-2.0); see
`THIRD_PARTY_NOTICES.md`.

### History options

If `history_date_selection:true`, any entities that do not define their own `history_start` and `history_end` configuration will be automatically linked to this. Please ensure a card of `type: energy-date-selection`  exists on the page before enabling this.

This can be added via the "Add Card" dialog by selecting Manual and entering the text `type: energy-date-selection`.

Alternatively `history_start` and `history_end` can be set to
* A specific date such as  `2022-03-01T12:00:00Z`
* A time code such as `10 days ago` `4 hours ago` `1 week ago` etc.
* An entity that will provide either a `date` or `number` (which will be used as the amount of hours ago to show). e.g. `input_number.example_number_value`

If you want to specify your own unit, configure the `history_start`/`history_end` as the below.
```
history_start:
  entity: input_number.example_number_value
  suffix: days ago
```

Each entity can individually override the base config by setting its own `history_start`/`history_end`, using any of the options above.
Any entity without its own settings will inherit the map level config.

### Circle options

Display a circle around the marker. It can either be called with the string `auto` or following options.

`circle: auto`

| name         | Default | note                                                                                         |
|--------------|---------|----------------------------------------------------------------------------------------------|
| `source`     |         | Where to get the radius from, see below for options.       |
| `attribute`  |         | The attribute to use for the radius (in case of `source: attribute`).         |
| `radius`     |         | Radius in meters (in case of `source: config`)(optional)                                                                            |
| `color`      |         | Color of the circle (will use the entity color if not set)                                                                          |
| `fill_opacity`| 0.2     | Opacity of the fill color                                                                    |

Source
* `auto` - Will use the `gps_accuracy`, then the `radius` attribute from the entity if available, otherwise will use the `radius` set in the config.
* `gps_accuracy` - Will use the `gps_accuracy` attribute from the entity.
* `radius` - Will use the `radius` attribute from the entity.
* `config` - Will use the `radius` set in the config.
* `attribute` - Will use the `attribute` set in the config.

### GeoJSON options

Display GeoJSON data from an entity attribute. This is useful for displaying zones, areas, routes, or any geographic data stored as GeoJSON in your Home Assistant entities.

The `geojson` option can be configured in several ways:

**Simple usage (uses default attribute name `geo_location`):**
```yaml
geojson: true
```

**Specify a custom attribute name:**
```yaml
geojson: zone_geojson
```

**Full configuration:**
```yaml
geojson:
  attribute: zone_geojson
  color: '#FF5733'
  weight: 3
  opacity: 1.0
  fill_opacity: 0.2
  hide_marker: false
```

| name           | Default        | note                                                                                         |
|----------------|----------------|----------------------------------------------------------------------------------------------|
| `attribute`    | `geo_location` | The entity attribute containing the GeoJSON data                                             |
| `color`        | Entity color   | Color for the GeoJSON features (lines and fills)                                             |
| `weight`       | 3              | Line weight for GeoJSON features                                                             |
| `opacity`      | 1.0            | Opacity of lines                                                                             |
| `fill_opacity` | 0.2            | Opacity of filled areas                                                                      |
| `hide_marker`  | false          | When set to `true`, hides the default entity marker and only displays the GeoJSON           |

**Supported GeoJSON types:**
- Point, MultiPoint
- LineString, MultiLineString
- Polygon, MultiPolygon
- GeometryCollection
- Feature, FeatureCollection

**Example entity configuration:**
```yaml
entities:
  - entity: sensor.my_zone
    geojson:
      attribute: zone_data
      color: '#3388ff'
      fill_opacity: 0.3
      hide_marker: true
```

The GeoJSON data in the entity attribute can be either:
- A JSON string: `'{"type": "Polygon", "coordinates": [[[0,0], [1,0], [1,1], [0,1], [0,0]]]}'`
- A parsed JSON object (if your integration provides it that way)

**Interactive Features:**
- GeoJSON zones are **clickable** - clicking on any GeoJSON feature will show the entity's more-info dialog (or trigger the configured `tap_action`)
- If the GeoJSON Feature or FeatureCollection includes properties, they will be displayed in tooltips when hovering over the features

### WMS and tile_layers options

| name      | note                                                                                                                                                        |
|-----------|-------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `url`     | The url of the layer, see [URL Entity lookup](#url-entity-lookup).                                                                                          |
| `options` | The leaflet layer [WMS options](https://leafletjs.com/reference.html#tilelayer-wms) or [Tile Layer options](https://leafletjs.com/reference.html#tilelayer) |
| `history` | The name of the layer option which controls the dat, if it supports a date or time option. Set history to the name of this property. The `history_start` value, state or date range picker will then set this property on the layer and update it as necessary. |
| `name`    | `tile_layers` only. Gives the layer a checkbox in a layer control at the map's top right, so viewers can turn it on and off. Each viewer's choice is kept in their own browser. |
| `show`    | `tile_layers` only, with `name`. `false` starts the layer off; the default is on. A viewer's own choice wins. |

```yaml
tile_layers:
  - url: https://tiles.example.com/overlay/{z}/{x}/{y}.png
    name: Rail lines
    show: true
    options:
      opacity: 0.4
      attribution: 'Overlay &copy; Example'
```

#### Zooming & `tile_layer_options.maxZoom`

By default the card will not zoom beyond [default property of the `maxZoom`](https://leafletjs.com/reference.html#tilelayer-maxzoom) of the tilelayer, the default is `18`, but it can be overriden as follows:

```
type: custom:live-track-map-card
tile_layer_options:
  maxZoom: 20
```

Keep in mind that the tile layer source also has a maximum zoom level, which is `20` for most OSM maps.

#### OSM & `tile_layer_options.referrerPolicy`

OpenStreetMap tile servers may block tile requests that lack a valid `Referer` header. By default, `referrerPolicy` is set to `"origin-when-cross-origin"`, which ensures the browser sends the origin with cross-origin tile requests as required by OSM's [Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/). You can override this if needed:

```
type: custom:live-track-map-card
tile_layer_options:
  referrerPolicy: "no-referrer"
```

#### Advanced WMS/Tile layer options

More complex use of the WMS/Tile history property can be configured within the history property of the layer.
* `property` is the option this should control (often named `time` or `date`)
* `source` defaults to auto (which means it will inherit from the main map settings). Set this to a date or number entity if this is different.
* `suffix` days ago/weeks ago as with other history entities
* `force_midnight` some WMS/Tile layers only work if the date is set as midnight.

```
  history:
    property: time
    source: input_number.test_number_value
    suffix: months ago
    force_midnight: true
```

### Plugin options
| name      | note                                                                                                                                                        |
|-----------|-------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `name`  | Mandatory, a helpful name for this instance of the plugin. Useful for debugging issues. |
| `url`     | The url of the plugin, if the plugin is in the file `/var/lib/hass/www/SomePlugin.js` , then this would be `./local/SomePlugin.js`. |
| `hacs.module` | The HACS module from which the plugin must be loaded if `url` is not set. |
| `hacs.file` | The file within the module from which the plugin must be loaded if `url is not set. |
| `options` | Options for configuring the plugin |

The `url` option is used when set.
If the `url` is not set and the `hacs` object is, the plugin will be loaded from the [HACS plugin](https://hacs.xyz/docs/publish/plugin/) with the given name and given filename.


#### Example config with plugin
```yaml
type: custom:live-track-map-card
x: -25.3744
y: 133.7751
plugins:
  - name: plugin
    url: /local/my-plugin.js
    options:
      some_option: true
  - name: another_instance
    url: /local/my-plugin.js
    options:
      some_option: false
```

#### Available Plugins

These plugins were written for ha-map-card. This card's plugin interface
(`src/models/Plugin.js`) is unchanged from ha-map-card 1.16.0, but none of
them has been tested with it.

| name      | description                                                                                         |
|-----------|-----------------------------------------------------------------------------------------------------|
| [`bom-radar`](https://github.com/bezmi/ha-map-card-plugin-bom-radar) | Displays the Australian BoM rainfall radar for the past 90 minutes and the radar forecast for the next 90 minutes as an overlay on the map. |
| [`buienradar`](https://github.com/Kevinjil/ha-map-card-buienradar) | Displays `buienradar.nl` as an overlay on the map |

You can find more plugins using the [ha-map-card-plugin](https://github.com/topics/ha-map-card-plugin) topic.

## Extra Tile Layers

### USGS Topo and Hydrography (optional, US only)

The US Geological Survey's The National Map serves two cached layers that work
well with this card: **USGS Topo** (contours, trails, glaciers, land and water
names; an opaque map, so it replaces what is under it) and **USGS
Hydrography** (rivers, streams and lakes on a transparent background, to lay
over any map). Both are public domain with no key and no usage limits
([USGS's terms](https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map));
USGS asks for the credit in the snippet. They cover the United States and its
territories: elsewhere the tiles stop after zoom 8 to 13. USGS caches them to
zoom 16, so `maxNativeZoom: 16` lets the map zoom further by enlarging them.

```yaml
tile_layers:
  - url: https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}
    name: USGS Topo
    show: false              # a viewer ticks it in the layer control
    options:
      maxNativeZoom: 16
      maxZoom: 19
      attribution: 'Map services and data available from <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">U.S. Geological Survey, National Geospatial Program</a>'
  - url: https://basemap.nationalmap.gov/arcgis/rest/services/USGSHydroCached/MapServer/tile/{z}/{y}/{x}
    name: USGS Hydrography
    show: false
    options:
      maxNativeZoom: 16
      maxZoom: 19
      opacity: 0.8
      attribution: 'Hydrography: <a href="https://www.usgs.gov/national-hydrography">USGS National Hydrography Dataset</a>'
```

Note the order in the URL: `{z}/{y}/{x}`, row before column, as ArcGIS serves
them. Each tile is cached by your browser for a day.

### Other providers


The [leaflet-extras](https://github.com/leaflet-extras/leaflet-providers) has a nice list of available [tile layer providers](https://leaflet-extras.github.io/leaflet-providers/preview/).

## Development

`git clone git@github.com:StrausbergAutomationWorks/LiveTrackMapCard.git`

This project uses [devenv.sh](https://devenv.sh/).

1. Install devenv
2. `devenv shell` and then `watch` or `devenv shell watch` to immediatly drop into a watched shell.

### NPM alternatives

* `npm install`
* `npm run build` (`npm run watch` to update on change)

### Developing Plugins
* All plugins should implement the `Plugin` class. See [`Plugin.js`](./src/models/Plugin.js) and [`Plugin.d.ts`](./src/models/Plugin.d.ts).
* For a concrete example, see [`CircleTestPlugin.js`](./plugins/CircleTestPlugin.js).
* Typescript example: see [bezmi/ha-map-card-plugin-bom-radar](https://github.com/bezmi/ha-map-card-plugin-bom-radar).
* For an example HACS plugin installation: see [`buienradar`](https://github.com/Kevinjil/ha-map-card-buienradar).

Tag your Github repo with [ha-map-card-plugin](https://github.com/topics/ha-map-card-plugin) for discoverability.


## ha-map-card: mentions and discussions

These are about [ha-map-card](https://github.com/nathan-gs/ha-map-card), the
card this one is derived from, and are kept here as its credits. Problems with
this card belong in this repository's issues, not in ha-map-card's threads.

* [home-assistant community: map-card: a slightly improved map-card](https://community.home-assistant.io/t/map-card-a-slightly-improved-map-card/693088), the discussion topic for ha-map-card.
* [nathan.gs: Map Card, a new leaflet based map with WMS and other advanced features](https://nathan.gs/2024/01/06/ha-map-card-a-new-and-alternative-leaflet-based-map/)
* [nathan.gs: Map Card, displaying Weather and Other Tile Layers](https://nathan.gs/2024/02/25/ha-map-card-displaying-weather-and-other-tilelayers/)
* [userbag.co.uk: Home Assistant Exploring location history](https://userbag.co.uk/development/home-assistant-exploring-location-history/)
* [leaflet.js: third party plugins](https://leafletjs.com/plugins.html#3rd-party-integration)
