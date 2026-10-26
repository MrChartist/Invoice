/**
 * R7-C: the one door to the hotel pack's chunk for hosts outside `/tables` (GST → Hotel, GST → Common credit, the bell),
 * so the chunk's preload list is written once here instead of into every host chunk (the R5-C `r5c-lazy` pattern).
 */
export const hotelChunk = () => import('./FrontDesk');
