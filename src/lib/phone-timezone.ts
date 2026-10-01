/**
 * A couple's likely time zone(s), from their phone number's area code.
 *
 * Used by the texting window (lib/texting-hours): automated texts go out only
 * between 9 am and 9 pm in the couple's own time zone. A US or Canadian area
 * code pins the zone for most numbers. Area codes that straddle two zones
 * (Florida's panhandle, western Kentucky, Tennessee, Indiana's corners, the
 * Dakotas, Nebraska, Kansas, Idaho, eastern Oregon, Michigan's UP, NW
 * Ontario, eastern BC) list both, and the window becomes the hours that are
 * daytime in every one of them. Unknown or non-NANP numbers return [] and the
 * caller falls back to the venue's time zone.
 *
 * Pure: no I/O.
 */

const ET = 'America/New_York';
const CT = 'America/Chicago';
const MT = 'America/Denver';
const AZ = 'America/Phoenix';
const PT = 'America/Los_Angeles';
const AK = 'America/Anchorage';
const HI = 'Pacific/Honolulu';
const AT = 'America/Halifax';
const NT = 'America/St_Johns';
const SK = 'America/Regina';
const PR = 'America/Puerto_Rico';

const ZONES: Record<string, string[]> = {};
function add(zones: string[], codes: string): void {
  for (const c of codes.split(/\s+/).filter(Boolean)) ZONES[c] = zones;
}

// ── United States ────────────────────────────────────────────────────────
add([CT], '205 251 256 334 659 938');                                   // Alabama
add([AK], '907');                                                       // Alaska
add([AZ], '480 520 602 623 928');                                       // Arizona
add([CT], '327 479 501 870');                                           // Arkansas
add([PT], '209 213 279 310 323 341 350 369 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 738 747 760 805 818 820 831 837 840 858 909 916 925 949 951'); // California
add([MT], '303 719 720 970 983');                                       // Colorado
add([ET], '203 475 860 959');                                           // Connecticut
add([ET], '302');                                                       // Delaware
add([ET], '202 771');                                                   // Washington, DC
add([ET], '239 305 321 324 352 386 407 561 645 656 689 727 728 754 772 786 813 863 904 941 954'); // Florida
add([ET, CT], '448 850');                                               // Florida panhandle
add([ET], '229 404 470 478 678 706 762 770 912 943');                   // Georgia
add([HI], '808');                                                       // Hawaii
add(['America/Boise', PT], '208 986');                                  // Idaho
add([CT], '217 224 309 312 331 447 464 618 630 708 730 773 779 815 847 861 872'); // Illinois
add([ET], '260 317 463 574 765');                                       // Indiana
add([CT], '219');                                                       // NW Indiana (Gary)
add([ET, CT], '812 930');                                               // southern Indiana
add([CT], '319 515 563 641 712');                                       // Iowa
add([CT], '316 913');                                                   // Kansas
add([CT, MT], '620 785');                                               // western Kansas
add([ET], '502 859');                                                   // Kentucky
add([ET, CT], '270 364 606');                                           // Kentucky, split
add([CT], '225 318 337 504 985');                                       // Louisiana
add([ET], '207');                                                       // Maine
add([ET], '227 240 301 410 443 667');                                   // Maryland
add([ET], '339 351 413 508 617 774 781 857 978');                       // Massachusetts
add([ET], '231 248 269 313 517 586 616 679 734 810 947 989');           // Michigan
add([ET, CT], '906');                                                   // Michigan UP
add([CT], '218 320 507 612 651 763 924 952');                           // Minnesota
add([CT], '228 471 601 662 769');                                       // Mississippi
add([CT], '235 314 417 557 573 636 660 816 975');                       // Missouri
add([MT], '406');                                                       // Montana
add([CT], '402 531');                                                   // Nebraska
add([CT, MT], '308');                                                   // western Nebraska
add([PT], '702 725 775');                                               // Nevada
add([ET], '603');                                                       // New Hampshire
add([ET], '201 551 609 640 732 848 856 862 908 973');                   // New Jersey
add([MT], '505 575');                                                   // New Mexico
add([ET], '212 315 329 332 347 363 516 518 585 607 624 631 646 680 716 718 838 845 914 917 929 934'); // New York
add([ET], '252 336 472 704 743 828 910 919 980 984');                   // North Carolina
add([CT, MT], '701');                                                   // North Dakota
add([ET], '216 220 234 283 326 330 380 419 436 440 513 567 614 740 937'); // Ohio
add([CT], '405 539 572 580 918');                                       // Oklahoma
add([PT], '458 503 971');                                               // Oregon
add([PT, MT], '541');                                                   // eastern Oregon
add([ET], '215 223 267 272 412 445 484 570 582 610 717 724 814 835 878'); // Pennsylvania
add([ET], '401');                                                       // Rhode Island
add([ET], '803 821 839 843 854 864');                                   // South Carolina
add([CT, MT], '605');                                                   // South Dakota
add([CT], '615 629 731 901');                                           // Tennessee, Central
add([ET], '865');                                                       // Tennessee, Eastern
add([ET, CT], '423 931');                                               // Tennessee, split
add([CT], '210 214 254 281 325 346 361 409 430 469 512 682 713 726 737 806 817 830 832 903 936 940 945 956 972 979'); // Texas
add([CT, MT], '432');                                                   // West Texas
add([MT], '915');                                                       // El Paso
add([MT], '385 435 801');                                               // Utah
add([ET], '802');                                                       // Vermont
add([ET], '276 434 540 571 686 703 757 804 826 948');                   // Virginia
add([PT], '206 253 360 425 509 564');                                   // Washington
add([ET], '304 681');                                                   // West Virginia
add([CT], '262 274 353 414 534 608 715 920');                           // Wisconsin
add([MT], '307');                                                       // Wyoming
add([PR], '787 939');                                                   // Puerto Rico
add(['America/St_Thomas'], '340');                                      // US Virgin Islands
add(['Pacific/Guam'], '671');                                           // Guam
add(['Pacific/Saipan'], '670');                                         // Northern Mariana Islands
add(['Pacific/Pago_Pago'], '684');                                      // American Samoa

// ── Canada ───────────────────────────────────────────────────────────────
add([ET], '226 249 289 343 365 382 416 437 519 548 613 647 683 705 742 753 905 942'); // Ontario
add([ET, CT], '807');                                                   // NW Ontario
add([ET], '263 354 367 418 438 450 468 514 579 581 819 873');           // Quebec
add([PT], '236 257 604 672 778');                                       // British Columbia
add([PT, MT], '250');                                                   // BC interior
add([MT], '368 403 587 780 825');                                       // Alberta
add([SK], '306 474 639');                                               // Saskatchewan
add([CT], '204 431 584');                                               // Manitoba
add([AT], '782 902');                                                   // Nova Scotia, PEI
add(['America/Moncton'], '428 506');                                    // New Brunswick
add([NT, AT], '709');                                                   // Newfoundland and Labrador

/**
 * The time zone(s) a phone number's area code covers, or [] when unknown
 * (toll-free, non-NANP, malformed).
 */
export function zonesForPhone(phone: string | null | undefined): string[] {
  let digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return [];
  return ZONES[digits.slice(0, 3)] ?? [];
}
