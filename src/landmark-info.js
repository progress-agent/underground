// Real-world dimensions, independent of model simplification and the height slider.
// Sources checked 12 September 2026. Dates distinguish completion from opening;
// phased buildings use a construction range. Height qualifiers identify the top.
export const LANDMARK_INFO = {
  shard: {name:'The Shard',height:'310m',date:'2012',sources:['https://www.kone.com/global/en/newsroom/references/the-shard.html']},
  'london-eye': {name:'London Eye',height:'135m',date:'1999 · opened 2000',sources:['https://www.londoneye.com/25th-anniversary/timeline/','https://www.londoneye.com/our-company/news/50-million-milestone-for-the-edf-energy-london-eye/']},
  'st-pauls': {name:"St Paul’s Cathedral",height:'111m',date:'1711',sources:['https://www.stpauls.co.uk/our-timeline','https://www.stpauls.co.uk/sites/default/files/2022-04/St%20Pauls%20Cathedral%20edited%20final%2012.1.22.pdf'],note:'1711 is the cathedral’s official declaration of completion; decoration continued afterwards.'},
  westminster: {name:'Palace of Westminster',height:'98.5m · Victoria Tower',dateLabel:'BUILT',date:'1840–1870',sources:['https://www.parliament.uk/about/living-heritage/building/palace/architecture/palacestructure/victoria-tower/','https://www.parliament.uk/about/living-heritage/building/palace/architecture/key-dates-fire1834-to-present/']},
  gherkin: {name:'The Gherkin · 30 St Mary Axe',height:'180m',date:'2004',sources:['https://www.fosterandpartners.com/news/celebrating-20-years-of-30-st-mary-axe','https://www.fosterandpartners.com/news/the-tulip-a-new-public-cultural-and-tourist-attraction-proposed-for-the-city-of-london'],note:'Completion year follows the architect; engineering accounts also cite practical completion in 2003.'},
  battersea: {name:'Battersea Power Station',height:'103m · chimneys',dateLabel:'BUILT',date:'1929–1955',sources:['https://batterseapowerstation.co.uk/about/heritage-history/','https://www.savebritainsheritage.org/news/save-teams-up-with-allies-morrison-on-new-battersea-scheme']},
  'canary-wharf': {name:'One Canada Square',height:'235m',date:'1991',sources:['https://energi-iq.com/project/one-canada-square-canary-wharf/','https://dmfk.co.uk/projects/one-canada-square']},
  '8-canada-square': {name:'8 Canada Square',height:'200m',date:'2002',sources:['https://www.fosterandpartners.com/projects/hsbc-uk-headquarters/?altTemplate=ProjectPDF']},
  '25-canada-square': {name:'25 Canada Square · Citi Tower',height:'200m',date:'2001',sources:['https://www.permasteelisagroup.com/fr/project/citi-tower-25-canada-square-refurbishment/']},
  'bt-tower': {name:'BT Tower',height:'189m · including aerials',date:'1964 · opened 1965',sources:['https://newsroom.bt.com/bt-group-announces-sale-of-bt-tower-to-mcr-hotels/']},
  'the-o2': {name:'The O2 · Millennium Dome',height:'100m masts · 50m roof',date:'1999',sources:['https://rshp.com/projects/culture-and-leisure/the-millennium-dome/']},
  wembley: {name:'Wembley Stadium',height:'133m · arch',date:'2007',sources:['https://help.wembleystadium.com/support/solutions/articles/7000028145-stats-and-facts','https://www.wembleystadium.com/news/2013/apr/25/90-years-of-wembley-stadium']},
  'london-stadium': {name:'London Stadium',height:'53m · original Olympic design',date:'2011 · converted 2016',sources:['https://data.parliament.uk/DepositedPapers/Files/DEP2009-0336/DEP2009-0336.pdf','https://www.whufc.com/en/the-club/history/stadiums/london-stadium-0'],note:'Original design height from government report, not a verified height of the reconstructed roof.'},
};
