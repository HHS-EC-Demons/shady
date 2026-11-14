import { SURFACES } from '@/engine/campus';
import { SAIL_COST_PER_SQUARE_FOOT, TREE_COST } from '@/engine/cost';
import { GROWTH_FEET, START_FEET } from '@/engine/growth';
import { TOUCH_LIMIT } from '@/engine/heat';
import { LIGHT_UNDER } from '@/engine/shade';

export type Source = { what: string; value: string; source: string; url: string };

const percent = (share: number) => `${Math.round(share * 100)}%`;

export const rows: Source[] = [
  { what: 'Buildings, lots, fields, courts and roads', value: 'Map data', source: 'OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
  { what: 'Trees already standing and real field surfaces', value: 'US aerial photo', source: 'USDA NAIP imagery through Microsoft Planetary Computer', url: 'https://planetarycomputer.microsoft.com/dataset/naip' },
  { what: 'Air temperature and sunshine for each hour', value: 'A real recorded day', source: 'Open-Meteo, ERA5 reanalysis', url: 'https://open-meteo.com/en/docs/historical-weather-api' },
  { what: 'Air temperature and sunshine for today', value: 'Forecast for each hour', source: 'Open-Meteo forecast', url: 'https://open-meteo.com/en/docs' },
  { what: 'Where the sun sits in the sky', value: 'Every 10 minutes', source: 'SunCalc', url: 'https://github.com/mourner/suncalc' },
  { what: 'Asphalt in full sun', value: `${SURFACES.asphalt.rise}°F over air`, source: 'Western Sydney University, School Microclimates', url: 'https://www.climatechange.environment.nsw.gov.au/sites/default/files/2021-06/School%20Microclimate%20Report.PDF' },
  { what: 'Asphalt in a parking lot, sun and tree shade', value: '140°F and 104°F', source: 'USDA Forest Service, Journal of Arboriculture', url: 'https://fs.usda.gov/psw/topics/urban_forestry/products/11/psw_cufr68_EffectsTreeCoverOnEmissions.pdf' },
  { what: 'Concrete in full sun', value: `${SURFACES.concrete.rise}°F over air`, source: 'Western Sydney University, School Microclimates', url: 'https://www.climatechange.environment.nsw.gov.au/sites/default/files/2021-06/School%20Microclimate%20Report.PDF' },
  { what: 'Artificial turf in full sun', value: `${SURFACES.turf.rise}°F over air`, source: 'New York State Department of Health, reporting Penn State', url: 'https://www.health.ny.gov/environmental/outdoors/synthetic_turf/crumb-rubber_infilled/fact_sheet.htm' },
  { what: 'Hottest turf reading in one field study', value: '200°F on a 98°F day', source: 'Brigham Young University, Synthetic Surface Heat Studies', url: 'https://assets.lawrenceks.org/agendas/cc/2011/09-13-11/pl_ta-4-6-11_synthetic_surface_heat_studies.pdf' },
  { what: 'Acrylic hard court in full sun', value: `${SURFACES.court.rise}°F over air`, source: 'Laykold, one test by a court maker', url: 'https://www.laykold.com/news/laykold-chill-science' },
  { what: 'Running track in full sun', value: `${SURFACES.track.rise}°F over air`, source: 'No measurement found, set equal to turf', url: '' },
  { what: 'Grass in full sun', value: `${SURFACES.grass.rise}°F over air`, source: 'Western Sydney University, watered 0 to 5, dry 21 to 37', url: 'https://www.climatechange.environment.nsw.gov.au/sites/default/files/2021-06/School%20Microclimate%20Report.PDF' },
  { what: 'Bare soil in full sun', value: `${SURFACES.soil.rise}°F over air`, source: 'Western Sydney University, School Microclimates', url: 'https://www.climatechange.environment.nsw.gov.au/sites/default/files/2021-06/School%20Microclimate%20Report.PDF' },
  { what: 'Sun that reaches the ground under a tree', value: percent(LIGHT_UNDER.tree), source: 'US EPA, Trees and Vegetation, 10 to 30 percent', url: 'https://www.epa.gov/sites/default/files/2017-05/documents/reducing_urban_heat_islands_ch_2.pdf' },
  { what: 'Sun that reaches the ground under a sail', value: percent(LIGHT_UNDER.sail), source: 'Texas Tech University, rubber surfacing in sun, tree shade and sail shade', url: 'https://www.sciencedaily.com/releases/2015/11/151111172514.htm' },
  { what: 'Sun that reaches the ground in building shade', value: percent(LIGHT_UNDER.block), source: 'Bulletin of the American Meteorological Society, 50 Grades of Shade', url: 'https://par.nsf.gov/biblio/10230332-grades-shade' },
  { what: 'Too hot to touch', value: `${TOUCH_LIMIT}°F`, source: 'NASA Jet Propulsion Laboratory', url: 'https://www.jpl.nasa.gov/images/pia25529-nasas-ecostress-maps-burn-risk-across-phoenix-streets' },
  { what: 'A new tree at planting', value: `${START_FEET} ft tall`, source: 'Trees For Houston, 15 gallon street tree', url: 'https://www.treesforhouston.org/streettrees' },
  { what: 'Tree growth each year', value: `${GROWTH_FEET} ft`, source: 'North Central Texas Council of Governments, tree matrix', url: 'https://www.nctcog.org/getmedia/e0ce468d-64cf-48d6-b05a-c253b2055fbd/Form-Based-Tree-Matrix-Draft-10-20-20.pdf?ext=.pdf' },
  { what: 'One tree, bought and planted', value: `$${TREE_COST.low} to $${TREE_COST.high}`, source: 'Trees For Houston', url: 'https://www.treesforhouston.org/streettrees' },
  { what: 'Fabric shade over a school yard', value: `$${SAIL_COST_PER_SQUARE_FOOT.low} to $${SAIL_COST_PER_SQUARE_FOOT.high} a sq ft`, source: 'Texas Department of Licensing and Regulation, school project records', url: 'https://www.tdlr.texas.gov/TABS/Search/Print/TABS2021000791' },
];

export const models: Source[] = [
  { what: 'Tree models', value: 'ez-tree, MIT', source: 'Daniel Greenheck', url: 'https://github.com/dgreenheck/ez-tree' },
  { what: 'Bark on the tree models', value: 'Bark012 and Bark014, CC0', source: 'ambientCG', url: 'https://ambientcg.com/view?id=Bark012' },
  { what: 'Brick on the building walls', value: 'Bricks 101, CC0', source: 'ambientCG', url: 'https://ambientcg.com/view?id=Bricks101' },
  { what: 'Car and people models', value: 'CC0', source: 'Quaternius through Poly Pizza', url: 'https://poly.pizza/m/Cz6yDaUcM9' },
  { what: 'Van model', value: 'Generic Van, CC BY 3.0', source: 'PuKkBuMXDD through Poly Pizza', url: 'https://poly.pizza/m/BbRojf2v3H' },
  { what: 'Parking lot light model', value: 'Street Light, CC BY 3.0', source: 'Warren Reid through Poly Pizza', url: 'https://poly.pizza/m/a7GJySoqzuL' },
];

export const rest: Source[] = [
  { what: 'Buildings with no mapped height', value: 'Sized from floor area', source: 'Estimate', url: '' },
  { what: 'Unmapped ground inside the school boundary', value: 'Counts as grass', source: 'Estimate', url: '' },
  { what: 'Slope of the ground', value: 'Flat', source: 'Estimate', url: '' },
];
export const sources: Source[] = [...rows, ...models, ...rest];

export function hostOf(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}

export function countSources(list: readonly Source[] = sources): number {
  return new Set(list.filter((row) => row.url).map((row) => hostOf(row.url))).size;
}
