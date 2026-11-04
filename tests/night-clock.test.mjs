import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hourFromPoint,nightAmount,litFraction,wrapHour} from '../src/night-clock.js';
import {clockDate,starDirection} from '../src/stars.js';
import {readFileSync} from 'node:fs';
test('clock landmarks and midnight wrap in both directions',()=>{
 for(const [x,y,h]of [[0,-1,12],[1,0,18],[0,1,0],[-1,0,6]])assert.equal(hourFromPoint(x,y),h);
 assert.ok(hourFromPoint(.001,1)>23.99);assert.ok(hourFromPoint(-.001,1)<.01);
 assert.equal(wrapHour(24.5),.5);assert.equal(wrapHour(-.5),23.5);
});
test('daylight never pays a night term; nights fade on both sides and occupancy falls',()=>{
 for(let h=6;h<=18;h+=.01)assert.equal(nightAmount(h),0);
 assert.equal(nightAmount(23),1);assert.equal(nightAmount(3),1);assert.ok(nightAmount(19)>.4&&nightAmount(19)<.6);
 assert.ok(litFraction(21)>litFraction(3));
});
test('London civil time resolves GMT and BST',()=>{
 assert.equal(clockDate(23,new Date(2026,10,3)).toISOString(),'2026-11-03T23:00:00.000Z');
 assert.equal(clockDate(23,new Date(2026,6,3)).toISOString(),'2026-07-03T22:00:00.000Z');
});
test('925 licensed real stars; sky pole stays near north at London latitude',()=>{
 const cat=JSON.parse(readFileSync(new URL('../public/data/stars-hyg.json',import.meta.url)));
 assert.equal(cat.length,925);assert.ok(cat.every(x=>x.length===5&&x[3]<=4.5));
 assert.ok(readFileSync(new URL('../public/data/stars-hyg.json',import.meta.url)).length<50000);
 const pole=cat.find(x=>x[0]===11767);assert.ok(pole);
 for(const h of [0,6,12,18,23]){const v=starDirection(pole[1],pole[2],clockDate(h,new Date(2026,10,3)));
 assert.ok(Math.abs(Math.asin(v.y)*180/Math.PI-51.5)<1);assert.ok(Math.abs(Math.atan2(v.x,-v.z)*180/Math.PI)<2);}
});
