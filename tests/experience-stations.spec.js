import {test,expect} from '@playwright/test';
import {stationApproachScale,stationLabelFont,labelBounds,labelBoundsOverlap,labelRank} from '../src/stations.js';

test('approach preserves distant type, grows smoothly, and caps at twice size',()=>{
  for(const base of [5,6.5,7,8.25,9.75]) {
    expect(stationLabelFont(1400,base)).toBe(base);
    expect(stationLabelFont(200,base)).toBe(2*base);
    expect(stationLabelFont(0,base)).toBe(2*base);
    let previous=stationLabelFont(3000,base);
    for(let d=2990;d>=0;d-=10) {
      const size=stationLabelFont(d,base);
      expect(size).toBeGreaterThanOrEqual(previous);
      expect(size-previous).toBeLessThan(.025*base);
      previous=size;
    }
  }
  expect(stationApproachScale(800)).toBeCloseTo(1.5);
});

test('declutter catches long names, adjacent rows and enlarged type',()=>{
  const long=labelBounds(100,100,260,16);
  expect(labelBoundsOverlap(long,labelBounds(200,100,60,14))).toBe(true);
  expect(labelBoundsOverlap(long,labelBounds(100,116,60,14))).toBe(true);
  expect(labelBoundsOverlap(long,labelBounds(100,160,60,14))).toBe(false);
  expect(labelBoundsOverlap(labelBounds(100,100,40,7),labelBounds(150,100,40,7))).toBe(false);
  expect(labelBoundsOverlap(labelBounds(100,100,80,14),labelBounds(150,100,80,14))).toBe(true);
});

test('approached stations beat distant hubs while distant hub hierarchy stays intact',()=>{
  expect(labelRank(0,200).priority).toBeGreaterThan(labelRank(2,1000).priority);
  expect(labelRank(2,2000).priority).toBeGreaterThan(labelRank(0,1800).priority);
  expect(labelRank(0,200).distance).toBeLessThan(labelRank(2,400).distance);
  expect(labelRank(1,1000,true).distance).toBeLessThan(labelRank(1,1000,false).distance);
});
