import { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import { getTier1Color } from '../../lib/colors.js';

export default function SimilarityBarChart({ scored, threshold, onCategoryClick, count = 30 }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!scored.length || !svgRef.current) return;

    const topN = scored.slice(0, count);
    const container = svgRef.current.parentElement;
    const width = container.clientWidth;
    const height = Math.max(400, topN.length * 24);
    const margin = { top: 20, right: 60, bottom: 20, left: 220 };

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    const x = d3.scaleLinear()
      .domain([0, 1])
      .range([margin.left, width - margin.right]);

    const y = d3.scaleBand()
      .domain(topN.map(d => d.id))
      .range([margin.top, height - margin.bottom])
      .padding(0.15);

    // Bars
    svg.selectAll('rect.bar')
      .data(topN)
      .join('rect')
      .attr('class', 'bar')
      .attr('x', margin.left)
      .attr('y', d => y(d.id))
      .attr('width', d => Math.max(0, x(d.similarity) - margin.left))
      .attr('height', y.bandwidth())
      .attr('rx', 3)
      .attr('fill', d => d.similarity >= threshold ? getTier1Color(d.tier1Parent) : '#334155')
      .attr('opacity', d => d.similarity >= threshold ? 0.85 : 0.4)
      .style('cursor', 'pointer')
      .on('click', (e, d) => onCategoryClick?.(d));

    // Tier 1 color dots
    svg.selectAll('circle.dot')
      .data(topN)
      .join('circle')
      .attr('class', 'dot')
      .attr('cx', margin.left - 212)
      .attr('cy', d => y(d.id) + y.bandwidth() / 2)
      .attr('r', 4)
      .attr('fill', d => getTier1Color(d.tier1Parent));

    // Labels (category names)
    svg.selectAll('text.label')
      .data(topN)
      .join('text')
      .attr('class', 'label')
      .attr('x', margin.left - 8)
      .attr('y', d => y(d.id) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .attr('fill', d => d.similarity >= threshold ? '#f1f5f9' : '#64748b')
      .attr('font-size', '12px')
      .text(d => d.name.length > 25 ? d.name.slice(0, 23) + '...' : d.name)
      .append('title').text(d => `${d.name}\n${d.tierPath || ''}`);

    // Score labels
    svg.selectAll('text.score')
      .data(topN)
      .join('text')
      .attr('class', 'score')
      .attr('x', d => x(d.similarity) + 6)
      .attr('y', d => y(d.id) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('fill', d => d.similarity >= threshold ? '#22c55e' : '#64748b')
      .attr('font-size', '10px')
      .attr('font-family', 'monospace')
      .text(d => d.similarity.toFixed(3));

    // Threshold line
    svg.append('line')
      .attr('x1', x(threshold))
      .attr('x2', x(threshold))
      .attr('y1', margin.top)
      .attr('y2', height - margin.bottom)
      .attr('stroke', '#f59e0b')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '4,4');

    svg.append('text')
      .attr('x', x(threshold) + 4)
      .attr('y', margin.top - 4)
      .attr('fill', '#f59e0b')
      .attr('font-size', '10px')
      .text(`threshold: ${threshold}`);

  }, [scored, threshold, count, onCategoryClick]);

  return <svg ref={svgRef} className="w-full" />;
}
