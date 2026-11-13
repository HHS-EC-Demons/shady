import { PrinterIcon } from '@phosphor-icons/react/dist/csr/Printer';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SURFACES, extentOf } from '@/engine/campus';
import { dollars, planCost } from '@/engine/cost';
import { TOUCH_LIMIT, rampColor } from '@/engine/heat';
import { unproject } from '@/engine/osm';
import { warmUp } from '@/engine/remote';
import { placeDay, placesOf, shadeDistance, walkToShade, type PlaceDay } from '@/engine/places';
import { clockLabel } from '@/engine/sun';
import { SQUARE_FEET, Yard } from '../yard/controller';
import { loadBundle, restorePlan } from '../yard/store';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${MONTHS[month - 1]} ${day} ${year}`;
}

function hotHours(report: PlaceDay): string {
  if (report.hotFrom === null || report.hotTo === null) return 'Never';
  return `${clockLabel(report.hotFrom)} to ${clockLabel(report.hotTo)}`;
}

function feet(meters: number): string {
  if (meters > 1e6) return 'None';
  return `${(Math.round((meters * 3.28084) / 5) * 5).toLocaleString('en-US')} ft`;
}

function fill(degrees: number): string {
  const [r, g, b] = rampColor(degrees);
  return `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`;
}

function spread(points: { x: number; y: number }[], radius: number): { x: number; y: number }[] {
  const moved = points.map((point) => ({ ...point }));
  const gap = radius * 2.15;
  for (let pass = 0; pass < 60; pass += 1) {
    let still = true;
    for (let i = 0; i < moved.length; i += 1) {
      for (let j = i + 1; j < moved.length; j += 1) {
        let dx = moved[j].x - moved[i].x;
        let dy = moved[j].y - moved[i].y;
        let distance = Math.hypot(dx, dy);
        if (distance >= gap) continue;
        if (distance < 1e-6) {
          dx = Math.cos(i * 2.4);
          dy = Math.sin(i * 2.4);
          distance = 1;
        }
        const push = (gap - distance) / 2;
        moved[i].x -= (dx / distance) * push;
        moved[i].y -= (dy / distance) * push;
        moved[j].x += (dx / distance) * push;
        moved[j].y += (dy / distance) * push;
        still = false;
      }
    }
    if (still) break;
  }
  return moved;
}

function Map({ yard }: { yard: Yard }) {
  const box = extentOf(yard.campus, 12);
  const means = useMemo(() => yard.surfaceMeans(), [yard]);
  const path = (ring: [number, number][]) => `${ring.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${(-y).toFixed(1)}`).join(' ')} Z`;
  const line = (ring: [number, number][]) => ring.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${(-y).toFixed(1)}`).join(' ');
  const wide = box.maxX - box.minX;
  const tall = box.maxY - box.minY;
  const mark = Math.max(wide, tall) / 62;
  const labels = useMemo(() => spread(yard.trees, mark), [yard, mark]);
  const order = ['grass', 'soil', 'asphalt', 'concrete', 'track', 'turf', 'court', 'water'];
  const patches = [...yard.campus.patches].sort((a, b) => order.indexOf(a.surface) - order.indexOf(b.surface));
  return (
    <svg
      viewBox={`${box.minX} ${-box.maxY} ${wide} ${tall}`}
      className="h-auto max-h-[78vh] w-full rounded-lg border border-rule bg-raised print:max-h-none"
      role="img"
      aria-label={`Map of ${yard.campus.name} with ${yard.trees.length} planned trees and ${yard.sails.length} planned sails`}
    >
      <defs>
        <clipPath id="grounds">
          {yard.campus.boundary.map((ring, index) => (
            <path key={index} d={path(ring)} />
          ))}
        </clipPath>
      </defs>
      <g clipPath={yard.campus.boundary.length > 0 ? 'url(#grounds)' : undefined}>
        <rect x={box.minX} y={-box.maxY} width={wide} height={tall} fill={fill(means[SURFACES.grass.code])} />
        {yard.campus.strips
          .filter((strip) => strip.surface !== 'track')
          .map((strip, index) => (
            <path key={index} d={line(strip.line)} fill="none" stroke={fill(means[SURFACES[strip.surface].code])} strokeWidth={strip.width} strokeLinecap="round" strokeLinejoin="round" />
          ))}
        {patches.map((patch, index) => (
          <path key={index} d={path(patch.ring)} fill={fill(means[SURFACES[patch.surface].code])} />
        ))}
        {yard.campus.strips
          .filter((strip) => strip.surface === 'track')
          .map((strip, index) => (
            <path key={index} d={line(strip.line)} fill="none" stroke={fill(means[SURFACES.track.code])} strokeWidth={strip.width} />
          ))}
      </g>
      {yard.campus.blocks
        .filter((block) => block.home)
        .map((block, index) => (
          <path key={index} d={path(block.ring)} fill="#f6f9f9" stroke="#47584f" strokeWidth={mark * 0.08} />
        ))}
      {yard.campus.boundary.map((ring, index) => (
        <path key={index} d={path(ring)} fill="none" stroke="#12261c" strokeWidth={mark * 0.1} />
      ))}
      {yard.sails.map((sail, index) => (
        <g key={sail.id}>
          <path d={path(sail.corners)} fill="#ffffff" stroke="#12261c" strokeWidth={mark * 0.14} />
          <text
            x={(sail.corners[0][0] + sail.corners[2][0]) / 2}
            y={-(sail.corners[0][1] + sail.corners[2][1]) / 2}
            fontSize={mark * 1.2}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#12261c"
            fontWeight={700}
          >
            {String.fromCharCode(65 + (index % 26))}
          </text>
        </g>
      ))}
      {yard.trees.map((tree, index) => (
        <g key={`spot ${tree.id}`}>
          <circle cx={tree.x} cy={-tree.y} r={tree.radius} fill="#2c5e41" fillOpacity={0.45} />
          <line x1={tree.x} y1={-tree.y} x2={labels[index].x} y2={-labels[index].y} stroke="#12261c" strokeWidth={mark * 0.12} />
          <circle cx={tree.x} cy={-tree.y} r={mark * 0.2} fill="#12261c" />
        </g>
      ))}
      {yard.trees.map((tree, index) => (
        <g key={`mark ${tree.id}`}>
          <circle cx={labels[index].x} cy={-labels[index].y} r={mark} fill="#2c5e41" stroke="#f6f9f9" strokeWidth={mark * 0.1} />
          <text x={labels[index].x} y={-labels[index].y} fontSize={mark * 1.1} textAnchor="middle" dominantBaseline="central" fill="#f6f9f9" fontWeight={700}>
            {index + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Sheet({ yard, base }: { yard: Yard; base: string }) {
  const places = useMemo(() => {
    const list = placesOf(yard.campus, yard.ground);
    const bare = shadeDistance(yard.ground, yard.bare, yard.peak);
    const planned = shadeDistance(yard.ground, yard.day, yard.peak);
    return list
      .map((place) => ({
        before: placeDay(place, yard.bare),
        walk: walkToShade(place, bare),
        walkAfter: walkToShade(place, planned),
      }))
      .sort((a, b) => b.before.peak - a.before.peak)
      .slice(0, 9);
  }, [yard]);
  const trees = useMemo(() => yard.trees.map((tree) => ({ tree, at: unproject(yard.campus.center, tree.x, tree.y), effect: yard.treeEffect(tree) })), [yard]);
  const sails = useMemo(
    () =>
      yard.sails.map((sail) => {
        const [a, , c] = sail.corners;
        const wide = Math.abs(c[0] - a[0]) * 3.28084;
        const deep = Math.abs(c[1] - a[1]) * 3.28084;
        return { sail, wide, deep, at: unproject(yard.campus.center, (a[0] + c[0]) / 2, (a[1] + c[1]) / 2), effect: yard.sailEffect(sail) };
      }),
    [yard],
  );
  const planned = trees.length + sails.length > 0;
  const before = yard.tallyOf('bare', yard.peak);
  const after = yard.tallyOf('day', yard.peak);
  const cooled = Math.round((yard.cooled(yard.peak) * SQUARE_FEET) / 100) * 100;
  const cost = planCost(trees.length, yard.sails);
  const figures = [
    { label: 'School', value: yard.campus.name, wide: true },
    { label: 'Day', value: dayLabel(yard.weather.date), wide: false },
    { label: 'Air peak', value: `${Math.round(Math.max(...yard.weather.air))}°F`, wide: false },
  ];
  if (planned) {
    figures.push(
      { label: `Trees at ${yard.years} years`, value: String(trees.length), wide: false },
      { label: 'Sails', value: String(sails.length), wide: false },
      { label: `Cooled ground at ${clockLabel(yard.peak)}`, value: `${cooled.toLocaleString('en-US')} sq ft`, wide: false },
      { label: `Ground over ${TOUCH_LIMIT}°F`, value: `${Math.round(before.hot * 100)}% to ${Math.round(after.hot * 100)}%`, wide: false },
      { label: 'Cost to plant and build', value: `${dollars(cost.low)} to ${dollars(cost.high)}`, wide: true },
    );
  }
  const marks = [
    ...trees.map(({ tree, at, effect }, index) => ({
      key: `tree ${tree.id}`,
      mark: String(index + 1),
      at,
      size: `${Math.round(tree.radius * 2 * 3.28084)} ft canopy`,
      effect,
    })),
    ...sails.map(({ sail, wide, deep, at, effect }, index) => ({
      key: `sail ${sail.id}`,
      mark: String.fromCharCode(65 + (index % 26)),
      at,
      size: `${Math.round(wide)} by ${Math.round(deep)} ft sail`,
      effect,
    })),
  ];

  return (
    <div className="shell mx-auto flex max-w-[1180px] flex-col gap-10 pb-20 pt-6 [&>*]:min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[clamp(2.25rem,4.4vw,3.75rem)]">Shade plan</h1>
        {planned ? (
          <Button size="lg" className="h-11 rounded-full px-5 text-base print:hidden" onClick={() => window.print()}>
            <PrinterIcon aria-hidden="true" weight="fill" />
            Print
          </Button>
        ) : (
          <a href={`${base}yard/`} className="pill">
            Plant in the yard
          </a>
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <Map yard={yard} />
        <div className="flex min-w-0 flex-col gap-8">
          <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-5">
            {figures.map((figure) => (
              <div key={figure.label} className={`border-t border-rule pt-3 ${figure.wide ? 'col-span-2' : ''}`}>
                <dt className="text-[0.9375rem] text-soft">{figure.label}</dt>
                <dd className="data m-0 text-[1.5rem] font-semibold leading-tight">{figure.value}</dd>
              </div>
            ))}
          </dl>

          <Table className="hidden sm:table">
            <TableHeader>
              <TableRow>
                <TableHead>Place</TableHead>
                <TableHead className="text-right">Peak</TableHead>
                <TableHead>Over {TOUCH_LIMIT}°F</TableHead>
                <TableHead className="text-right">Walk to shade</TableHead>
                {planned && <TableHead className="text-right">With plan</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {places.map(({ before: was, walk, walkAfter }) => (
                <TableRow key={was.label}>
                  <TableCell className="font-medium">{was.label}</TableCell>
                  <TableCell className="data text-right">{Math.round(was.peak)}°F</TableCell>
                  <TableCell className="data">{hotHours(was)}</TableCell>
                  <TableCell className="data text-right">{feet(walk)}</TableCell>
                  {planned && <TableCell className={`data text-right ${walk - walkAfter >= 3 ? 'font-semibold text-leaf' : ''}`}>{feet(walkAfter)}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ul className="m-0 list-none p-0 sm:hidden">
            {places.map(({ before: was, walk, walkAfter }) => (
              <li key={was.label} className="border-t border-rule py-3">
                <p className="flex items-baseline justify-between gap-4">
                  <span className="font-medium">{was.label}</span>
                  <span className="data font-semibold">{Math.round(was.peak)}°F</span>
                </p>
                <p className="data text-[0.9375rem] text-soft">
                  Over {TOUCH_LIMIT}°F {hotHours(was).toLowerCase()}
                </p>
                <p className="data text-[0.9375rem]">
                  Walk to shade {feet(walk)}
                  {planned ? <span className={walk - walkAfter >= 3 ? 'font-semibold text-leaf' : ''}>, with plan {feet(walkAfter)}</span> : null}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {planned && (
        <>
          <Table className="hidden sm:table">
            <TableHeader>
              <TableRow>
                <TableHead>Mark</TableHead>
                <TableHead>Latitude and longitude</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Shades</TableHead>
                <TableHead className="text-right">Cooler by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {marks.map((item) => (
                <TableRow key={item.key}>
                  <TableCell className="data font-semibold">{item.mark}</TableCell>
                  <TableCell className="data">
                    {item.at.lat.toFixed(5)}, {item.at.lon.toFixed(5)}
                  </TableCell>
                  <TableCell className="data">{item.size}</TableCell>
                  <TableCell>{item.effect.place}</TableCell>
                  <TableCell className="data text-right">{Math.round(item.effect.cooler)}°F</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ul className="m-0 list-none p-0 sm:hidden">
            {marks.map((item) => (
              <li key={item.key} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 border-t border-rule py-3">
                <span className="data text-[1.125rem] font-semibold">{item.mark}</span>
                <span>
                  <span className="data block text-[0.9375rem]">
                    {item.at.lat.toFixed(5)}, {item.at.lon.toFixed(5)}
                  </span>
                  <span className="block text-[0.9375rem] text-soft">
                    {item.size}, {item.effect.place.toLowerCase()} {Math.round(item.effect.cooler)}°F cooler
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default function PlanSheet({ base }: { base: string }) {
  const [yard, setYard] = useState<Yard | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    warmUp();
    loadBundle(base)
      .then((file) => Yard.open(file.campus, file.weather))
      .then(async (next) => {
        restorePlan(next);
        await next.settled();
        next.close();
        if (live) setYard(next);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [base]);

  if (failed) return <p className="shell py-16 text-lg">The plan did not load. Reload the page.</p>;
  if (!yard) {
    return (
      <div className="shell mx-auto flex max-w-[1180px] flex-col gap-6 pb-20 pt-6">
        <Skeleton className="h-14 w-72 bg-muted" />
        <Skeleton className="h-[60vh] w-full bg-muted" />
      </div>
    );
  }
  return <Sheet yard={yard} base={base} />;
}
