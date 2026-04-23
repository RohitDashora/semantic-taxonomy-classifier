import { useRef, useEffect, useMemo } from 'react';
import * as d3 from 'd3';
import { getTier1Color } from '../../lib/colors.js';

export default function RadarChart({ scored }) {
  const svgRef = useRef();

  // Compute max similarity per Tier 1
  const tier1Data = useMemo(() => {
    if (!scored.length) return [];
    const map = new Map();
    scored.forEach(s => {
      const t1 = s.tier1Parent;
      if (!map.has(t1) || s.similarity > map.get(t1)) {
        map.set(t1, s.similarity);
      }
    });
    return [...map.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [scored]);

  useEffect(() => {
    if (!tier1Data.length || !svgRef.current) return;

    const size = 400;
    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 60;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', size).attr('height', size);

    const angleSlice = (Math.PI * 2) / tier1Data.length;

    // Concentric circles
    [0.25, 0.5, 0.75, 1.0].forEach(level => {
      svg.append('circle')
        .attr('cx', cx).attr('cy', cy)
        .attr('r', radius * level)
        .attr('fill', 'none')
        .attr('stroke', '#334155')
        .attr('stroke-width', 0.5);

      svg.append('text')
        .attr('x', cx + 4)
        .attr('y', cy - radius * level + 3)
        .attr('fill', '#64748b')
        .attr('font-size', '9px')
        .text(level.toFixed(2));
    });

    // Axes
    tier1Data.forEach((d, i) => {
      const angle = angleSlice * i - Math.PI / 2;
      const x2 = cx + radius * Math.cos(angle);
      const y2 = cy + radius * Math.sin(angle);

      svg.append('line')
        .attr('x1', cx).attr('y1', cy)
        .attr('x2', x2).attr('y2', y2)
        .attr('stroke', '#334155')
        .attr('stroke-width', 0.5);

      // Label
      const lx = cx + (radius + 20) * Math.cos(angle);
      const ly = cy + (radius + 20) * Math.sin(angle);
      svg.append('text')
        .attr('x', lx).attr('y', ly)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('fill', getTier1Color(d.name))
        .attr('font-size', '11px')
        .text(d.name.length > 16 ? d.name.slice(0, 14) + '..' : d.name)
        .append('title').text(`${d.name}: ${d.value.toFixed(3)}`);
    });

    // Filled polygon
    const points = tier1Data.map((d, i) => {
      const angle = angleSlice * i - Math.PI / 2;
      const r = radius * d.value;
      return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
    });

    svg.append('polygon')
      .attr('points', points.map(p => p.join(',')).join(' '))
      .attr('fill', 'rgba(59, 130, 246, 0.2)')
      .attr('stroke', '#3b82f6')
      .attr('stroke-width', 2);

    // Dots at vertices
    points.forEach((p, i) => {
      svg.append('circle')
        .attr('cx', p[0]).attr('cy', p[1])
        .attr('r', 4)
        .attr('fill', getTier1Color(tier1Data[i].name));
    });

  }, [tier1Data]);

  return <svg ref={svgRef} className="mx-auto" />;
}
