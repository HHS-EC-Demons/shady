import * as THREE from 'three';

export type Vec = [number, number, number];

function facing(points: Vec[], centre: Vec): Vec | undefined {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [ax, ay, az] = points[index];
    const [bx, by, bz] = points[(index + 1) % points.length];
    nx += (ay - by) * (az + bz);
    ny += (az - bz) * (ax + bx);
    nz += (ax - bx) * (ay + by);
    mx += ax;
    my += ay;
    mz += az;
  }
  const length = Math.hypot(nx, ny, nz);
  if (length < 1e-12) return undefined;
  const count = points.length;
  const outward = nx * (mx / count - centre[0]) + ny * (my / count - centre[1]) + nz * (mz / count - centre[2]) >= 0 ? 1 : -1;
  return [(nx / length) * outward, (ny / length) * outward, (nz / length) * outward];
}

export class Clay {
  positions: number[] = [];
  shades: number[] = [];
  normals: (Vec | undefined)[] = [];
  indices: number[] = [];

  vertex(point: Vec, shade: Vec, normal?: Vec): number {
    this.positions.push(point[0], point[1], point[2]);
    this.shades.push(shade[0], shade[1], shade[2]);
    this.normals.push(normal);
    return this.positions.length / 3 - 1;
  }

  private at(index: number): Vec {
    return [this.positions[index * 3], this.positions[index * 3 + 1], this.positions[index * 3 + 2]];
  }

  triangle(a: number, b: number, c: number, centre: Vec): void {
    const [ax, ay, az] = this.at(a);
    const [bx, by, bz] = this.at(b);
    const [cx, cy, cz] = this.at(c);
    const ex = bx - ax;
    const ey = by - ay;
    const ez = bz - az;
    const fx = cx - ax;
    const fy = cy - ay;
    const fz = cz - az;
    const nx = ey * fz - ez * fy;
    const ny = ez * fx - ex * fz;
    const nz = ex * fy - ey * fx;
    const ox = (ax + bx + cx) / 3 - centre[0];
    const oy = (ay + by + cy) / 3 - centre[1];
    const oz = (az + bz + cz) / 3 - centre[2];
    if (nx * ox + ny * oy + nz * oz >= 0) this.indices.push(a, b, c);
    else this.indices.push(a, c, b);
  }

  face(points: Vec[], shade: number | Vec, centre: Vec): void {
    const tone: Vec = typeof shade === 'number' ? [shade, shade, shade] : shade;
    const normal = facing(points, centre);
    const ids = points.map((point) => this.vertex(point, tone, normal));
    for (let index = 1; index + 1 < ids.length; index += 1) this.triangle(ids[0], ids[index], ids[index + 1], centre);
  }

  loft(rings: Vec[][], shade: (segment: number, edge: number) => number | Vec, centre: Vec): void {
    for (let segment = 0; segment + 1 < rings.length; segment += 1) {
      const from = rings[segment];
      const to = rings[segment + 1];
      for (let edge = 0; edge < from.length; edge += 1) {
        const next = (edge + 1) % from.length;
        this.face([from[edge], from[next], to[next], to[edge]], shade(segment, edge), centre);
      }
    }
  }

  box(low: Vec, high: Vec, shade: number | Vec): void {
    const [x0, y0, z0] = low;
    const [x1, y1, z1] = high;
    const bottom: Vec[] = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]];
    const top: Vec[] = [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
    const centre: Vec = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    this.loft([bottom, top], () => shade, centre);
    this.face(bottom, shade, centre);
    this.face(top, shade, centre);
  }

  tube(from: Vec, to: Vec, radius: number, sides: number, shade: number | Vec, capped = true): void {
    const axis = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]).normalize();
    const helper = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(axis, helper).normalize();
    const other = new THREE.Vector3().crossVectors(axis, side).normalize();
    const ring = (base: Vec): Vec[] =>
      Array.from({ length: sides }, (_, step) => {
        const angle = (step / sides) * Math.PI * 2;
        const c = Math.cos(angle) * radius;
        const s = Math.sin(angle) * radius;
        return [base[0] + side.x * c + other.x * s, base[1] + side.y * c + other.y * s, base[2] + side.z * c + other.z * s];
      });
    const start = ring(from);
    const end = ring(to);
    const centre: Vec = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
    this.loft([start, end], () => shade, centre);
    if (!capped) return;
    this.face(start, shade, centre);
    this.face(end, shade, centre);
  }

  lathe(profile: [number, number][], sides: number, depth: number, shade: number | Vec, at: Vec = [0, 0, 0]): void {
    const tone: Vec = typeof shade === 'number' ? [shade, shade, shade] : shade;
    let low = Infinity;
    let high = -Infinity;
    for (const [y] of profile) {
      low = Math.min(low, y);
      high = Math.max(high, y);
    }
    const centre: Vec = [at[0], at[1] + (low + high) / 2, at[2]];
    const rows = profile.map(([y, radius]) => {
      if (radius <= 0) return [this.vertex([at[0], at[1] + y, at[2]], tone)];
      return Array.from({ length: sides }, (_, step) => {
        const angle = ((step + 0.5) / sides) * Math.PI * 2;
        return this.vertex([at[0] + Math.cos(angle) * radius * depth, at[1] + y, at[2] + Math.sin(angle) * radius], tone);
      });
    });
    for (let row = 0; row + 1 < rows.length; row += 1) {
      const a = rows[row];
      const b = rows[row + 1];
      for (let step = 0; step < sides; step += 1) {
        const next = (step + 1) % sides;
        if (a.length === 1) this.triangle(a[0], b[step], b[next], centre);
        else if (b.length === 1) this.triangle(a[step], a[next], b[0], centre);
        else {
          this.triangle(a[step], a[next], b[next], centre);
          this.triangle(a[step], b[next], b[step], centre);
        }
      }
    }
  }

  geometry(colored: boolean): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    if (colored) geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.shades, 3));
    geometry.setIndex(this.indices);
    geometry.computeVertexNormals();
    const normal = geometry.getAttribute('normal');
    this.normals.forEach((flat, index) => {
      if (flat) normal.setXYZ(index, flat[0], flat[1], flat[2]);
    });
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }
}
