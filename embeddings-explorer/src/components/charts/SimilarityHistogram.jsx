import { useRef, useEffect } from 'react';
import * as d3 from 'd3';

export default function SimilarityHistogram({ scored, threshold }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!scored.length || !svgRef.current) return;

    const container = svgRef.current.parentElement;
    const width = container.clientWidth;
    const height = 160;
    const margin = { top: 10, right: 10, bottom: 28, left: 36 };

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    const bins = d3.bin()
      .domain([0, 1])
      .thresholds(20)
      (scored.map(s => s.similarity));

    const x = d3.scaleLinear()
      .domain([0, 1])
      .range([margin.left, width - margin.right]);

    const y = d3.scaleLinear()
      .domain([0, d3.max(bins, b => b.length)])
      .nice()
      .range([height - margin.bottom, margin.top]);

    // Bars
    svg.selectAll('rect')
      .data(bins)
      .join('rect')
      .attr('x', d => x(d.x0) + 1)
      .attr('y', d => y(d.length))
      .attr('width', d => Math.max(0, x(d.x1) - x(d.x0) - 2))
      .attr('height', d => Math.max(0, y(0) - y(d.length)))
      .attr('rx', 1)
      .attr('fill', d => d.x0 >= threshold ? '#22c55e' : '#475569')
      .attr('opacity', d => d.x0 >= threshold ? 0.8 : 0.4);

    // X axis
    svg.append('g')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format('.1f')))
      .call(g => g.select('.domain').attr('stroke', '#475569'))
      .call(g => g.selectAll('.tick text').attr('fill', '#94a3b8').attr('font-size', '9px'))
      .call(g => g.selectAll('.tick line').attr('stroke', '#475569'));

    // Y axis
    svg.append('g')
      .attr('transform', `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(4))
      .call(g => g.select('.domain').attr('stroke', '#475569'))
      .call(g => g.selectAll('.tick text').attr('fill', '#94a3b8').attr('font-size', '9px'))
      .call(g => g.selectAll('.tick line').attr('stroke', '#475569'));

    // Threshold line
    svg.append('line')
      .attr('x1', x(threshold))
      .attr('x2', x(threshold))
      .attr('y1', margin.top)
      .attr('y2', height - margin.bottom)
      .attr('stroke', '#f59e0b')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '3,3');

  }, [scored, threshold]);

  return <svg ref={svgRef} className="w-full" />;
}
