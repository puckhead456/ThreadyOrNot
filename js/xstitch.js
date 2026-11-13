'use strict';
/* =====================================================================
 * xstitch.js — window.XStitch
 *
 * Pure cross-stitch logic for Thready or Not. No DOM, no network, no
 * globals other than `window.XStitch`. Phase 1 of the cross-stitch craft
 * module described in docs/CRAFTS.md and docs/research/cross-stitch.md.
 *
 * Contents
 *   1.  small helpers
 *   2.  DMC floss table (MIT data, see the notice above FLOSS_DMC_RAW)
 *   3.  colour maths: sRGB -> CIELAB, deltaE76, CIEDE2000, nearestFloss
 *   4.  symbols: SYMBOLS + assignSymbols
 *   5.  packing: RLE cells + base64 progress bitmaps
 *   6.  geometry and floss maths: finishedSize, skeins, confetti, stats
 *   7.  craft plumbing: normalize, summary, TEMPLATES
 *   8.  OXS: parseOXS, toOXS
 *   9.  PDF key parser: parseKey
 *   10. stubs: extractGrid (beta, later), printableHTML (B7, later)
 *   11. registration with Store
 * ===================================================================== */
(function () {

  /* ================================================================== *
   * 1. Helpers
   * ================================================================== */

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  function str(v, dflt) {
    return typeof v === 'string' ? v : (dflt === undefined ? '' : dflt);
  }

  function num(v, dflt) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : dflt;
  }

  function clampInt(v, lo, hi, dflt) {
    var n = typeof v === 'number' ? v : parseInt(v, 10);
    if (!isFinite(n)) return dflt;
    n = Math.round(n);
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }

  function round2(n) { return Math.round(n * 100) / 100; }
  function round1(n) { return Math.round(n * 10) / 10; }

  /** 5721 -> '5,721' (fixed separator, whatever the device locale). */
  function fmtInt(n) {
    var v = Math.round(Number(n) || 0), neg = v < 0;
    var s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return neg ? '-' + s : s;
  }

  function deepCopy(o) {
    try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; }
  }

  function pushOnce(list, msg) {
    for (var i = 0; i < list.length; i++) if (list[i] === msg) return;
    list.push(msg);
  }

  /* ================================================================== *
   * 2. DMC floss table
   *
   * Colour data derived from sharlagelfand/dmc
   *   https://github.com/sharlagelfand/dmc
   *   data-raw/floss_adrianj.csv (454 colours), cleaned exactly as that
   *   package's data-raw/floss.R does: the six Excel-mangled hex codes are
   *   restored, the nine rows whose R/G/B columns disagree with the hex
   *   column take the hand-checked hex, and the abbreviated colour names
   *   are expanded (Vy -> Very, Dk -> Dark, Lt -> Light, ...).
   *   Its own upstream source is https://github.com/adrianj/CrossStitchCreator/
   *
   *   MIT License. Copyright (c) 2020 Sharla Gelfand
   *
   *   Permission is hereby granted, free of charge, to any person obtaining a
   *   copy of this software and associated documentation files (the
   *   "Software"), to deal in the Software without restriction, including
   *   without limitation the rights to use, copy, modify, merge, publish,
   *   distribute, sublicense, and/or sell copies of the Software, and to
   *   permit persons to whom the Software is furnished to do so, subject to
   *   the following conditions:
   *
   *   The above copyright notice and this permission notice shall be included
   *   in all copies or substantial portions of the Software.
   *
   *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
   *   OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
   *   MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
   *   IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
   *   CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
   *   TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
   *   SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
   *
   * There is no official DMC RGB table; every published list is a scan or
   * eyeball approximation of a physical shade card, so screen colours are
   * always approximate. "DMC" is used nominatively only.
   *
   * Packed as 'code|name|hex' to keep the source small; r/g/b are derived
   * once at load.
   * ================================================================== */

  var FLOSS_DMC_RAW = [
    '3713|Salmon Very Light|ffe2e2',
    '761|Salmon Light|ffc9c9',
    '760|Salmon|f5adad',
    '3712|Salmon Medium|f18787',
    '3328|Salmon Dark|e36d6d',
    '347|Salmon Very Dark|bf2d2d',
    '353|Peach|fed7cc',
    '352|Coral Light|fd9c97',
    '351|Coral|e96a67',
    '350|Coral Medium|e04848',
    '349|Coral Dark|d21035',
    '817|Coral Red Very Dark|bb051f',
    '3708|Melon Light|ffcbd5',
    '3706|Melon Medium|ffadbc',
    '3705|Melon Dark|ff7992',
    '3801|Melon Very Dark|e74967',
    '666|Red Bright|e31d42',
    '321|Red|c72b3b',
    '304|Red Medium|b71f33',
    '498|Red Dark|a7132b',
    '816|Garnet|970b23',
    '815|Garnet Medium|87071f',
    '814|Garnet Dark|7b001b',
    '894|Carnation Very Light|ffb2bb',
    '893|Carnation Light|fc90a2',
    '892|Carnation Medium|ff798c',
    '891|Carnation Dark|ff5773',
    '818|Baby Pink|ffdfd9',
    '957|Geranium Pale|fdb5b5',
    '956|Geranium|ff9191',
    '309|Rose Dark|ba4a4a',
    '963|Dusty Rose Ultra Very Light|ffd7d7',
    '3716|Dusty Rose Medium Very Light|ffbdbd',
    '962|Dusty Rose Medium|e68a8a',
    '961|Dusty Rose Dark|cf7373',
    '3833|Raspberry Light|ea8699',
    '3832|Raspberry Medium|db556e',
    '3831|Raspberry Dark|b32f48',
    '777|Raspberry Very Dark|913546',
    '819|Baby Pink Light|ffeeeb',
    '3326|Rose Light|fbadb4',
    '776|Pink Medium|fcb0b9',
    '899|Rose Medium|f27688',
    '335|Rose|ee546e',
    '326|Rose Very Dark|b33b4b',
    '151|Dusty Rose Very Light|f0ced4',
    '3354|Dusty Rose Light|e4a6ac',
    '3733|Dusty Rose|e8879b',
    '3731|Dusty Rose Very Dark|da6783',
    '3350|Dusty Rose Ultra Dark|bc4365',
    '150|Dusty Rose Ultra Very Dark|ab0249',
    '3689|Mauve Light|fbbfc2',
    '3688|Mauve Medium|e7a9ac',
    '3687|Mauve|c96b70',
    '3803|Mauve Dark|ab3357',
    '3685|Mauve Very Dark|881531',
    '605|Cranberry Very Light|ffc0cd',
    '604|Cranberry Light|ffb0be',
    '603|Cranberry|ffa4be',
    '602|Cranberry Medium|e24874',
    '601|Cranberry Dark|d1286a',
    '600|Cranberry Very Dark|cd2f63',
    '3806|Cyclamen Pink Light|ff8cae',
    '3805|Cyclamen Pink|f3478b',
    '3804|Cyclamen Pink Dark|e02876',
    '3609|Plum Ultra Light|f4aed5',
    '3608|Plum Very Light|ea9cc4',
    '3607|Plum Light|c54989',
    '718|Plum|9c2462',
    '917|Plum Medium|9b1359',
    '915|Plum Dark|820043',
    '225|Shell Pink Ultra Very Light|ffdfd5',
    '224|Shell Pink Very Light|ebb7af',
    '152|Shell Pink Medium Light|e2a099',
    '223|Shell Pink Light|cc847c',
    '3722|Shell Pink Medium|bc6c64',
    '3721|Shell Pink Dark|a14b51',
    '221|Shell Pink Very Dark|883e43',
    '778|Antique Mauve Very Light|dfb3bb',
    '3727|Antique Mauve Light|dba9b2',
    '316|Antique Mauve Medium|b7737f',
    '3726|Antique Mauve Dark|9b5b66',
    '315|Antique Mauve Medium Dark|814952',
    '3802|Antique Mauve Very Dark|714149',
    '902|Garnet Very Dark|822637',
    '3743|Antique Violet Very Light|d7cbd3',
    '3042|Antique Violet Light|b79da7',
    '3041|Antique Violet Medium|956f7c',
    '3740|Antique Violet Dark|785762',
    '3836|Grape Light|ba91aa',
    '3835|Grape Medium|946083',
    '3834|Grape Dark|72375d',
    '154|Grape Very Dark|572433',
    '211|Lavender Light|e3cbe3',
    '210|Lavender Medium|c39fc3',
    '209|Lavender Dark|a37ba7',
    '208|Lavender Very Dark|835b8b',
    '3837|Lavender Ultra Dark|6c3a6e',
    '327|Violet Dark|633666',
    '153|Violet Very Light|e6ccd9',
    '554|Violet Light|dbb3cb',
    '553|Violet|a3638b',
    '552|Violet Medium|803a6b',
    '550|Violet Very Dark|5c184e',
    '3747|Blue Violet Very Light|d3d7ed',
    '341|Blue Violet Light|b7bfdd',
    '156|Blue Violet Medium Light|a3aed1',
    '340|Blue Violet Medium|ada7c7',
    '155|Blue Violet Medium Dark|9891b6',
    '3746|Blue Violet Dark|776b98',
    '333|Blue Violet Very Dark|5c5478',
    '157|Cornflower Blue Very Light|bbc3d9',
    '794|Cornflower Blue Light|8f9cc1',
    '793|Cornflower Blue Medium|707da2',
    '3807|Cornflower Blue|60678c',
    '792|Cornflower Blue Dark|555b7b',
    '158|Cornflower Blue Medium Very Dark|4c526e',
    '791|Cornflower Blue Very Dark|464563',
    '3840|Lavender Blue Light|b0c0da',
    '3839|Lavender Blue Medium|7b8eab',
    '3838|Lavender Blue Dark|5c7294',
    '800|Delft Blue Pale|c0ccde',
    '809|Delft Blue|94a8c6',
    '799|Delft Blue Medium|748eb6',
    '798|Delft Blue Dark|466a8e',
    '797|Royal Blue|13477d',
    '796|Royal Blue Dark|11416d',
    '820|Royal Blue Very Dark|0e365c',
    '162|Blue Ultra Very Light|dbecf5',
    '827|Blue Very Light|bddded',
    '813|Blue Light|a1c2d7',
    '826|Blue Medium|6b9ebf',
    '825|Blue Dark|4781a5',
    '824|Blue Very Dark|396987',
    '996|Electric Blue Medium|30c2ec',
    '3843|Electric Blue|14aad0',
    '995|Electric Blue Dark|2696b6',
    '3846|Turquoise Light Bright|06e3e6',
    '3845|Turquoise Medium Bright|04c4ca',
    '3844|Turquoise Dark Bright|12aeba',
    '159|Gray Blue Light|c7cad7',
    '160|Gray Blue Medium|999fb7',
    '161|Gray Blue|7880a4',
    '3756|Baby Blue Ultra Very Light|eefcfc',
    '775|Baby Blue Very Light|d9ebf1',
    '3841|Baby Blue Pale|cddfed',
    '3325|Baby Blue Light|b8d2e6',
    '3755|Baby Blue|93b4ce',
    '334|Baby Blue Medium|739fc1',
    '322|Baby Blue Dark|5a8fb8',
    '312|Baby Blue Very Dark|35668b',
    '803|Baby Blue Ultra Very Dark|2c597c',
    '336|Navy Blue|253b73',
    '823|Navy Blue Dark|213063',
    '939|Navy Blue Very Dark|1b2853',
    '3753|Antique Blue Ultra Very Light|dbe2e9',
    '3752|Antique Blue Very Light|c7d1db',
    '932|Antique Blue Light|a2b5c6',
    '931|Antique Blue Medium|6a859e',
    '930|Antique Blue Dark|455c71',
    '3750|Antique Blue Very Dark|384c5e',
    '828|Sky Blue Very Light|c5e8ed',
    '3761|Sky Blue Light|acd8e2',
    '519|Sky Blue|7eb1c8',
    '518|Wedgewood Light|4f93a7',
    '3760|Wedgewood Medium|3e85a2',
    '517|Wedgewood Dark|3b768f',
    '3842|Wedgewood Very Dark|32667c',
    '311|Navy Blue Medium|1c5066',
    '747|Peacock Blue Very Light|e5fcfd',
    '3766|Peacock Blue Light|99cfd9',
    '807|Peacock Blue|64abba',
    '806|Peacock Blue Dark|3d95a5',
    '3765|Peacock Blue Very Dark|347f8c',
    '3811|Turquoise Very Light|bce3e6',
    '598|Turquoise Light|90c3cc',
    '597|Turquoise|5ba3b3',
    '3810|Turquoise Dark|488e9a',
    '3809|Turquoise Very Dark|3f7c85',
    '3808|Turquoise Ultra Very Dark|366970',
    '928|Gray Green Very Light|dde3e3',
    '927|Gray Green Light|bdcbcb',
    '926|Gray Green Medium|98aeae',
    '3768|Gray Green Dark|657f7f',
    '924|Gray Green Very Dark|566a6a',
    '3849|Teal Green Light|52b3ae',
    '3848|Teal Green Medium|419392',
    '3847|Teal Green Dark|347d75',
    '964|Seagreen Light|a9e2d8',
    '959|Seagreen Medium|59c7b4',
    '958|Seagreen Dark|3eb6a1',
    '3812|Seagreen Very Dark|2f8c84',
    '3851|Green Bright Light|49b3a1',
    '943|Aquamarine Medium|3d9384',
    '3850|Green Bright Dark|378477',
    '993|Aquamarine Very Light|90c0b4',
    '992|Aquamarine Light|6fae9f',
    '3814|Aquamarine|508b7d',
    '991|Aquamarine Dark|477b6e',
    '966|Baby Green Medium|b9d7c0',
    '564|Jade Very Light|a7cdaf',
    '563|Jade Light|8fc098',
    '562|Jade Medium|53976a',
    '505|Jade Green|338362',
    '3817|Celadon Green Light|99c3aa',
    '3816|Celadon Green|65a57d',
    '163|Celadon Green Medium|4d8361',
    '3815|Celadon Green Dark|477759',
    '561|Jade Very Dark|2c6a45',
    '504|Blue Green Very Light|c4decc',
    '3813|Blue Green Light|b2d4bd',
    '503|Blue Green Medium|7bac94',
    '502|Blue Green|5b9071',
    '501|Blue Green Dark|396f52',
    '500|Blue Green Very Dark|044d33',
    '955|Nile Green Light|a2d6ad',
    '954|Nile Green|88ba91',
    '913|Nile Green Medium|6dab77',
    '912|Emerald Green Light|1b9d6b',
    '911|Emerald Green Medium|189065',
    '910|Emerald Green Dark|187e56',
    '909|Emerald Green Very Dark|156f49',
    '3818|Emerald Green Ultra Very Dark|115a3b',
    '369|Pistachio Green Very Light|d7edcc',
    '368|Pistachio Green Light|a6c298',
    '320|Pistachio Green Medium|69885a',
    '367|Pistachio Green Dark|617a52',
    '319|Pistachio Green Very Dark|205f2e',
    '890|Pistachio Green Ultra Dark|174923',
    '164|Forest Green Light|c8d8b8',
    '989|Forest Green|8da675',
    '988|Forest Green Medium|738b5b',
    '987|Forest Green Dark|587141',
    '986|Forest Green Very Dark|405230',
    '772|Yellow Green Very Light|e4ecd4',
    '3348|Yellow Green Light|ccd9b1',
    '3347|Yellow Green Medium|71935c',
    '3346|Hunter Green|406a3a',
    '3345|Hunter Green Dark|1b5915',
    '895|Hunter Green Very Dark|1b5300',
    '704|Chartreuse Bright|9ecf34',
    '703|Chartreuse|7bb547',
    '702|Kelly Green|47a72f',
    '701|Green Light|3f8f29',
    '700|Green Bright|07731b',
    '699|Green|056517',
    '907|Parrot Green Light|c7e666',
    '906|Parrot Green Medium|7fb335',
    '905|Parrot Green Dark|628a28',
    '904|Parrot Green Very Dark|557822',
    '472|Avocado Green Ultra Light|d8e498',
    '471|Avocado Green Very Light|aebf79',
    '470|Avocado Green Light|94ab4f',
    '469|Avocado Green|72843c',
    '937|Avocado Green Medium|627133',
    '936|Avocado Green Very Dark|4c5826',
    '935|Avocado Green Dark|424d21',
    '934|Avocado Green Black|313919',
    '523|Fern Green Light|abb197',
    '3053|Green Gray|9ca482',
    '3052|Green Gray Medium|889268',
    '3051|Green Gray Dark|5f6648',
    '524|Fern Green Very Light|c4cdac',
    '522|Fern Green|969e7e',
    '520|Fern Green Dark|666d4f',
    '3364|Pine Green|83975f',
    '3363|Pine Green Medium|728256',
    '3362|Pine Green Dark|5e6b47',
    '165|Moss Green Very Light|eff4a4',
    '3819|Moss Green Light|e0e868',
    '166|Moss Green Medium Light|c0c840',
    '581|Moss Green|a7ae38',
    '580|Moss Green Dark|888d33',
    '734|Olive Green Light|c7c077',
    '733|Olive Green Medium|bcb34c',
    '732|Olive Green|948c36',
    '731|Olive Green Dark|938b37',
    '730|Olive Green Very Dark|827b30',
    '3013|Khaki Green Light|b9b982',
    '3012|Khaki Green Medium|a6a75d',
    '3011|Khaki Green Dark|898a58',
    '372|Mustard Light|ccb784',
    '371|Mustard|bfa671',
    '370|Mustard Medium|b89d64',
    '834|Golden Olive Very Light|dbbe7f',
    '833|Golden Olive Light|c8ab6c',
    '832|Golden Olive|bd9b51',
    '831|Golden Olive Medium|aa8f56',
    '830|Golden Olive Dark|8d784b',
    '829|Golden Olive Very Dark|7e6b42',
    '613|Drab Brown Very Light|dcc4aa',
    '612|Drab Brown Light|bc9a78',
    '611|Drab Brown|967656',
    '610|Drab Brown Dark|796047',
    '3047|Yellow Beige Light|e7d6c1',
    '3046|Yellow Beige Medium|d8bc9a',
    '3045|Yellow Beige Dark|bc966a',
    '167|Yellow Beige Very Dark|a77c49',
    '746|Off White|fcfcee',
    '677|Old Gold Very Light|f5eccb',
    '422|Hazelnut Brown Light|c69f7b',
    '3828|Hazelnut Brown|b78b61',
    '420|Hazelnut Brown Dark|a07042',
    '869|Hazelnut Brown Very Dark|835e39',
    '728|Topaz|e4b468',
    '783|Topaz Medium|ce9124',
    '782|Topaz Dark|ae7720',
    '781|Topaz Very Dark|a26d20',
    '780|Topaz Ultra Very Dark|94631a',
    '676|Old Gold Light|e5ce97',
    '729|Old Gold Medium|d0a53e',
    '680|Old Gold Dark|bc8d0e',
    '3829|Old Gold Very Dark|a98204',
    '3822|Straw Light|f6dc98',
    '3821|Straw|f3ce75',
    '3820|Straw Dark|dfb65f',
    '3852|Straw Very Dark|cd9d37',
    '445|Lemon Light|fffb8b',
    '307|Lemon|fded54',
    '973|Canary Bright|ffe300',
    '444|Lemon Dark|ffd600',
    '3078|Golden Yellow Very Light|fdf9cd',
    '727|Topaz Very Light|fff1af',
    '726|Topaz Light|fdd755',
    '725|Topaz Medium Light|ffc840',
    '972|Canary Deep|ffb515',
    '745|Yellow Pale Light|ffe9ad',
    '744|Yellow Pale|ffe793',
    '743|Yellow Medium|fed376',
    '742|Tangerine Light|ffbf57',
    '741|Tangerine Medium|ffa32b',
    '740|Tangerine|ff8b00',
    '970|Pumpkin Light|f78b13',
    '971|Pumpkin|f67f00',
    '947|Burnt Orange|ff7b4d',
    '946|Burnt Orange Medium|eb6307',
    '900|Burnt Orange Dark|d15807',
    '967|Apricot Very Light|ffded5',
    '3824|Apricot Light|fecdc2',
    '3341|Apricot|fcab98',
    '3340|Apricot Medium|ff836f',
    '608|Orange Bright|fd5d35',
    '606|Orange Red Bright|fa3203',
    '951|Tawny Light|ffe2cf',
    '3856|Mahogany Ultra Very Light|ffd3b5',
    '722|Orange Spice Light|f7976f',
    '721|Orange Spice Medium|f27842',
    '720|Orange Spice Dark|e55c1f',
    '3825|Pumpkin Pale|fdbd96',
    '922|Copper Light|e27323',
    '921|Copper|c66218',
    '920|Copper Medium|ac5414',
    '919|Red Copper|a64510',
    '918|Red Copper Dark|82340a',
    '3770|Tawny Very Light|ffeee3',
    '945|Tawny|fbd5bb',
    '402|Mahogany Very Light|f7a777',
    '3776|Mahogany Light|cf7939',
    '301|Mahogany Medium|b35f2b',
    '400|Mahogany Dark|8f430f',
    '300|Mahogany Very Dark|6f2f00',
    '3823|Yellow Ultra Pale|fffde3',
    '3855|Autumn Gold Light|fad396',
    '3854|Autumn Gold Medium|f2af68',
    '3853|Autumn Gold Dark|f29746',
    '3827|Golden Brown Pale|f7bb77',
    '977|Golden Brown Light|dc9c56',
    '976|Golden Brown Medium|c28142',
    '3826|Golden Brown|ad7239',
    '975|Golden Brown Dark|914f12',
    '948|Peach Very Light|fee7da',
    '754|Peach Light|f7cbbf',
    '3771|Terra Cotta Ultra Very Light|f4bba9',
    '758|Terra Cotta Very Light|eeaa9b',
    '3778|Terra Cotta Light|d98978',
    '356|Terra Cotta Medium|c56a5b',
    '3830|Terra Cotta|b95544',
    '355|Terra Cotta Dark|984436',
    '3777|Terra Cotta Very Dark|863022',
    '3779|Rosewood Ultra Very Light|f8cac8',
    '3859|Rosewood Light|ba8b7c',
    '3858|Rosewood Medium|964a3f',
    '3857|Rosewood Dark|68251a',
    '3774|Desert Sand Very Light|f3e1d7',
    '950|Desert Sand Light|eed3c4',
    '3064|Desert Sand|c48e70',
    '407|Desert Sand Dark|bb8161',
    '3773|Desert Sand Medium|b67552',
    '3772|Desert Sand Very Dark|a06c50',
    '632|Desert Sand Ultra Very Dark|875539',
    '453|Shell Gray Light|d7cecb',
    '452|Shell Gray Medium|c0b3ae',
    '451|Shell Gray Dark|917b73',
    '3861|Cocoa Light|a68881',
    '3860|Cocoa|7d5d57',
    '779|Cocoa Dark|624b45',
    '712|Cream|fffbef',
    '739|Tan Ultra Very Light|f8e4c8',
    '738|Tan Very Light|eccc9e',
    '437|Tan Light|e4bb8e',
    '436|Tan|cb9051',
    '435|Brown Very Light|b87748',
    '434|Brown Light|985e33',
    '433|Brown Medium|7a451f',
    '801|Coffee Brown Dark|653919',
    '898|Coffee Brown Very Dark|492a13',
    '938|Coffee Brown Ultra Dark|361f0e',
    '3371|Black Brown|1e1108',
    '543|Beige Brown Ultra Very Light|f2e3ce',
    '3864|Mocha Beige Light|cbb69c',
    '3863|Mocha Beige Medium|a4835c',
    '3862|Mocha Beige Dark|8a6e4e',
    '3031|Mocha Brown Very Dark|4b3c2a',
    'B5200|Snow White|ffffff',
    'White|White|fcfbf8',
    '3865|Winter White|f9f7f1',
    'Ecru|Ecru|f0eada',
    '822|Beige Gray Light|e7e2d3',
    '644|Beige Gray Medium|ddd8cb',
    '642|Beige Gray Dark|a49878',
    '640|Beige Gray Very Dark|857b61',
    '3787|Brown Gray Dark|625d50',
    '3021|Brown Gray Very Dark|4f4b41',
    '3024|Brown Gray Very Light|ebeae7',
    '3023|Brown Gray Light|b1aa97',
    '3022|Brown Gray Medium|8e9078',
    '535|Ash Gray Very Light|636458',
    '3033|Mocha Brown Very Light|e3d8cc',
    '3782|Mocha Brown Light|d2bca6',
    '3032|Mocha Brown Medium|b39f8b',
    '3790|Beige Gray Ultra Dark|7f6a55',
    '3781|Mocha Brown Dark|6b5743',
    '3866|Mocha Brown Ultra Very Light|faf6f0',
    '842|Beige Brown Very Light|d1baa1',
    '841|Beige Brown Light|b69b7e',
    '840|Beige Brown Medium|9a7c5c',
    '839|Beige Brown Dark|675541',
    '838|Beige Brown Very Dark|594937',
    '3072|Beaver Gray Very Light|e6e8e8',
    '648|Beaver Gray Light|bcb4ac',
    '647|Beaver Gray Medium|b0a69c',
    '646|Beaver Gray Dark|877d73',
    '645|Beaver Gray Very Dark|6e655c',
    '844|Beaver Gray Ultra Dark|484848',
    '762|Pearl Gray Very Light|ececec',
    '415|Pearl Gray|d3d3d6',
    '318|Steel Gray Light|ababab',
    '414|Steel Gray Dark|8c8c8c',
    '168|Pewter Very Light|d1d1d1',
    '169|Pewter Light|848484',
    '317|Pewter Gray|6c6c6c',
    '413|Pewter Gray Dark|565656',
    '3799|Pewter Gray Very Dark|424242',
    '310|Black|000000'
  ];

  /* Wave J: DMC's 35 colours released in 2017, numbered 1 to 35 (charts
     print them as '04' or '4'). They are NOT in the MIT source above, which
     predates them. Names are DMC's own; the hex values are APPROXIMATE, even
     more so than the table above: they come from the published DMC-to-RGB
     conversion charts as recalled without a download, and should be checked
     against a physical shade card before anyone relies on them. They are
     appended (never interleaved), so every older entry keeps its index and
     wins a tie in nearestFloss. */
  var FLOSS_DMC_2017_RAW = [
    '1|White Tin|e3e3e6',
    '2|Tin|d7d7d8',
    '3|Tin Medium|b8b8bb',
    '4|Tin Dark|aeaeb1',
    '5|Driftwood Light|e3ccbe',
    '6|Driftwood Medium Light|dcc6b8',
    '7|Driftwood|8f7b6e',
    '8|Driftwood Dark|6a5046',
    '9|Cocoa Very Dark|552014',
    '10|Tender Green Very Light|edfed9',
    '11|Tender Green Light|e2edb5',
    '12|Tender Green|cdd99a',
    '13|Nile Green Medium Light|bff6e0',
    '14|Apple Green Pale|d0fbb2',
    '15|Apple Green|d1eda4',
    '16|Chartreuse Light|c9c258',
    '17|Yellow Plum Light|e5e272',
    '18|Yellow Plum|d9d56d',
    '19|Autumn Gold Medium Light|f7c95f',
    '20|Shrimp|f7af93',
    '21|Alizarin Light|d79982',
    '22|Alizarin|bc604e',
    '23|Apple Blossom|ede2ed',
    '24|White Lavender|e0d7ee',
    '25|Lavender Ultra Light|dad2e9',
    '26|Lavender Pale|d7cae6',
    '27|White Violet|f0eef9',
    '28|Eggplant Medium Light|9086a9',
    '29|Eggplant|674076',
    '30|Blueberry Medium Light|7d77a5',
    '31|Blueberry|50518d',
    '32|Blueberry Dark|4d2e8a',
    '33|Fuchsia|9c599e',
    '34|Fuchsia Dark|7d3064',
    '35|Fuchsia Very Dark|46052d'
  ];

  function buildFlossTable(raw, extra) {
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var p = raw[i].split('|');
      var hex = p[2];
      var e = {
        code: p[0],
        name: p[1],
        hex: hex,
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16)
      };
      if (extra) for (var k in extra) e[k] = extra[k];
      out.push(e);
    }
    return out;
  }

  var FLOSS = {
    dmc: buildFlossTable(FLOSS_DMC_RAW).concat(
      buildFlossTable(FLOSS_DMC_2017_RAW, { approx: true, since: 2017 }))
  };

  /* code -> entry, for hexFor(). Keys are lowercased. */
  var DMC_BY_CODE = {};
  /* The same without the 2017 colours. The key parser decides what is a
     floss code with it, so that a bare '9' or '20' (a ruler, an Anchor
     number, a row label) means exactly what it meant before those colours
     had swatches; it fills in their swatch afterwards (see keyHexFor). */
  var DMC_KEY_CODES = {};
  (function () {
    for (var i = 0; i < FLOSS.dmc.length; i++) {
      DMC_BY_CODE[FLOSS.dmc[i].code.toLowerCase()] = FLOSS.dmc[i];
      if (!FLOSS.dmc[i].since) DMC_KEY_CODES[FLOSS.dmc[i].code.toLowerCase()] = FLOSS.dmc[i];
    }
  })();

  /* Names stitchers and charts actually write for the three named shades. */
  var DMC_ALIASES = {
    'blanc': 'white',
    'blanc neige': 'b5200',
    'blancneige': 'b5200',
    'snow white': 'b5200',
    'snowwhite': 'b5200',
    'white': 'white',
    'ecru': 'ecru',
    'b5200': 'b5200'
  };

  function canonIn(table, c) {
    if (!c) return '';
    if (DMC_ALIASES[c]) return DMC_ALIASES[c];
    if (table[c]) return c;
    // '0310' and '310 ' style noise; also '04' for the 2017 colour 4
    var stripped = c.replace(/^0+(?=\d)/, '');
    if (table[stripped]) return stripped;
    return c;
  }

  function canonDmcCode(code) {
    var c = String(code == null ? '' : code).trim().toLowerCase();
    /* 'DMC 04' / 'dmc#310': the brand written into the code itself */
    c = c.replace(/^dmc(?:\s*[#:.-]?\s*)(?=[a-z0-9])/, '');
    return canonIn(DMC_BY_CODE, c);
  }

  /**
   * The key parser's lookup: exactly the pre-2017 table and the old
   * normalising, so every decision the parser makes about "is this a floss
   * code" is unchanged by the 2017 colours (fixtures are the ratchet).
   * parseKey fills in the 2017 swatches once the rows are decided.
   */
  function keyHexFor(brand, code) {
    var b = String(brand == null ? '' : brand).trim().toLowerCase();
    if (b && b !== 'dmc') return null;
    var e = DMC_KEY_CODES[canonIn(DMC_KEY_CODES, String(code == null ? '' : code).trim().toLowerCase())];
    return e ? e.hex : null;
  }

  /**
   * hexFor(brand, code) -> '1a1a1a' | null
   * DMC only in v1. An empty/unknown brand is treated as DMC, so a chart that
   * never names its brand still gets swatches.
   */
  function hexFor(brand, code) {
    var b = String(brand == null ? '' : brand).trim().toLowerCase();
    if (b && b !== 'dmc') return null;
    var e = DMC_BY_CODE[canonDmcCode(code)];
    return e ? e.hex : null;
  }

  function flossFor(brand, code) {
    var b = String(brand == null ? '' : brand).trim().toLowerCase();
    if (b && b !== 'dmc') return null;
    return DMC_BY_CODE[canonDmcCode(code)] || null;
  }

  /* ================================================================== *
   * 3. Colour maths
   * ================================================================== */

  /* 256-entry sRGB -> linear-light LUT (A3.2 step 3). */
  var LIN = new Float64Array(256);
  (function () {
    for (var i = 0; i < 256; i++) {
      var c = i / 255;
      LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
  })();

  var XN = 0.95047, YN = 1.00000, ZN = 1.08883;   // D65
  var EPS = 216 / 24389, KAP = 24389 / 27;

  function labF(t) {
    return t > EPS ? Math.pow(t, 1 / 3) : (KAP * t + 16) / 116;
  }

  /**
   * rgbToLab(r, g, b) -> [L, a, b]
   * Also accepts rgbToLab([r,g,b]) and rgbToLab({ r, g, b }).
   */
  function rgbToLab(r, g, b) {
    if (Array.isArray(r)) { g = r[1]; b = r[2]; r = r[0]; }
    else if (isObj(r)) { var o = r; r = o.r; g = o.g; b = o.b; }
    var R = LIN[clampInt(r, 0, 255, 0)];
    var G = LIN[clampInt(g, 0, 255, 0)];
    var B = LIN[clampInt(b, 0, 255, 0)];
    var X = 0.4124564 * R + 0.3575761 * G + 0.1804375 * B;
    var Y = 0.2126729 * R + 0.7151522 * G + 0.0721750 * B;
    var Z = 0.0193339 * R + 0.1191920 * G + 0.9503041 * B;
    var fx = labF(X / XN), fy = labF(Y / YN), fz = labF(Z / ZN);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function hexToRgb(hex) {
    var h = String(hex == null ? '' : hex).replace(/^#/, '').trim();
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function hexToLab(hex) {
    var rgb = hexToRgb(hex);
    return rgb ? rgbToLab(rgb[0], rgb[1], rgb[2]) : null;
  }

  /** Plain Euclidean distance in Lab. Fast; used in inner loops. */
  function deltaE76(lab1, lab2) {
    var dL = lab1[0] - lab2[0], da = lab1[1] - lab2[1], db = lab1[2] - lab2[2];
    return Math.sqrt(dL * dL + da * da + db * db);
  }

  var DEG = Math.PI / 180;
  var POW25_7 = 6103515625;   // 25^7

  function hueDeg(b, ap) {
    if (ap === 0 && b === 0) return 0;
    var h = Math.atan2(b, ap) / DEG;
    return h < 0 ? h + 360 : h;
  }

  /**
   * CIEDE2000 (Sharma, Wu & Dalal's formulation, kL = kC = kH = 1).
   * Reference pair from the published test data:
   *   (50, 2.6772, -79.7751) vs (50, 0, -82.7485) -> 2.0425
   */
  function deltaE2000(lab1, lab2) {
    var L1 = lab1[0], a1 = lab1[1], b1 = lab1[2];
    var L2 = lab2[0], a2 = lab2[1], b2 = lab2[2];

    var C1 = Math.sqrt(a1 * a1 + b1 * b1);
    var C2 = Math.sqrt(a2 * a2 + b2 * b2);
    var Cbar = (C1 + C2) / 2;
    var Cbar7 = Math.pow(Cbar, 7);
    var G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + POW25_7)));

    var a1p = (1 + G) * a1, a2p = (1 + G) * a2;
    var C1p = Math.sqrt(a1p * a1p + b1 * b1);
    var C2p = Math.sqrt(a2p * a2p + b2 * b2);
    var h1p = hueDeg(b1, a1p), h2p = hueDeg(b2, a2p);

    var dLp = L2 - L1;
    var dCp = C2p - C1p;

    var dhp = 0;
    if (C1p * C2p !== 0) {
      dhp = h2p - h1p;
      if (dhp > 180) dhp -= 360;
      else if (dhp < -180) dhp += 360;
    }
    var dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * DEG);

    var Lbarp = (L1 + L2) / 2;
    var Cbarp = (C1p + C2p) / 2;

    var hbarp;
    if (C1p * C2p === 0) {
      hbarp = h1p + h2p;
    } else if (Math.abs(h1p - h2p) <= 180) {
      hbarp = (h1p + h2p) / 2;
    } else if (h1p + h2p < 360) {
      hbarp = (h1p + h2p + 360) / 2;
    } else {
      hbarp = (h1p + h2p - 360) / 2;
    }

    var T = 1
      - 0.17 * Math.cos((hbarp - 30) * DEG)
      + 0.24 * Math.cos((2 * hbarp) * DEG)
      + 0.32 * Math.cos((3 * hbarp + 6) * DEG)
      - 0.20 * Math.cos((4 * hbarp - 63) * DEG);

    var dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
    var Cbarp7 = Math.pow(Cbarp, 7);
    var RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + POW25_7));

    var d50 = (Lbarp - 50) * (Lbarp - 50);
    var SL = 1 + (0.015 * d50) / Math.sqrt(20 + d50);
    var SC = 1 + 0.045 * Cbarp;
    var SH = 1 + 0.015 * Cbarp * T;
    var RT = -Math.sin((2 * dTheta) * DEG) * RC;

    var t1 = dLp / SL, t2 = dCp / SC, t3 = dHp / SH;
    return Math.sqrt(t1 * t1 + t2 * t2 + t3 * t3 + RT * t2 * t3);
  }

  /* Lab cache for the floss tables, built on first use. */
  var FLOSS_LAB = {};
  function flossLab(brandKey) {
    if (FLOSS_LAB[brandKey]) return FLOSS_LAB[brandKey];
    var table = FLOSS[brandKey] || [];
    var labs = [];
    for (var i = 0; i < table.length; i++) labs.push(rgbToLab(table[i].r, table[i].g, table[i].b));
    FLOSS_LAB[brandKey] = labs;
    return labs;
  }

  /**
   * nearestFloss(rgbOrLab, opts) -> [{ code, name, hex, de }]
   *
   * Input may be:
   *   [r, g, b]           (0..255)          - treated as sRGB
   *   { r, g, b }                            - sRGB
   *   { L, a, b }                            - CIELAB
   *   { lab: [L, a, b] }                     - CIELAB
   *   '#1a1a1a' / '1a1a1a'                   - sRGB hex
   * opts = { brand: 'DMC', limit: 5, metric: 'de2000' | 'de76' }
   */
  function nearestFloss(rgbOrLab, opts) {
    opts = isObj(opts) ? opts : {};
    var brandKey = String(opts.brand || 'DMC').toLowerCase();
    if (!FLOSS[brandKey]) return [];
    var limit = clampInt(opts.limit, 1, 500, 5);
    var metric = opts.metric === 'de76' ? deltaE76 : deltaE2000;

    var lab = null;
    if (typeof rgbOrLab === 'string') {
      lab = hexToLab(rgbOrLab);
    } else if (Array.isArray(rgbOrLab)) {
      lab = opts.isLab ? rgbOrLab.slice(0, 3) : rgbToLab(rgbOrLab[0], rgbOrLab[1], rgbOrLab[2]);
    } else if (isObj(rgbOrLab)) {
      if (Array.isArray(rgbOrLab.lab)) lab = rgbOrLab.lab.slice(0, 3);
      else if (typeof rgbOrLab.L === 'number') lab = [rgbOrLab.L, num(rgbOrLab.a, 0), num(rgbOrLab.b, 0)];
      else if (typeof rgbOrLab.r === 'number') lab = rgbToLab(rgbOrLab.r, rgbOrLab.g, rgbOrLab.b);
    }
    if (!lab) return [];

    var table = FLOSS[brandKey];
    var labs = flossLab(brandKey);
    var scored = [];
    for (var i = 0; i < table.length; i++) {
      scored.push({ i: i, de: metric(lab, labs[i]) });
    }
    scored.sort(function (a, b) { return a.de - b.de || a.i - b.i; });
    var out = [];
    for (var k = 0; k < limit && k < scored.length; k++) {
      var e = table[scored[k].i];
      out.push({ code: e.code, name: e.name, hex: e.hex, de: scored[k].de });
    }
    return out;
  }

  /* ================================================================== *
   * 4. Symbols (B3.5)
   * ================================================================== */

  /* ~64 curated glyphs, ordered lightest-ink first. No 0 O o I l 1. */
  var SYMBOLS = [
    '·', ':', '▫', '▪', '○', '●', '◌', '◍',
    '△', '▲', '▽', '▼', '◇', '◆',
    '□', '■', '☆', '★', '+', '×', '÷', '=',
    '≡', '~', '≈', '^', 'v', '<',
    '>', '(', ')', '[', ']', '{', '}', '/', '\\', '|', '—', '‖',
    '¤', '§',
    '¶', '†', '‡', '¥', '£', '∞', '∴',
    '∅', 'Ω', 'Δ', 'Σ', 'Ψ', 'Φ', 'Θ',
    'Λ', 'Ξ', 'Π', 'ß', 'æ',
    '2', '3', '4', '5', '6', '7', '8', '9'
  ];

  /* Overflow pool, only used by palettes larger than SYMBOLS. */
  var SYMBOLS_EXTRA = (
    'ABCEFGHJKLMNPQRSTUWYZabcdefghjkmnpqrstuwxyz'
  ).split('');

  var SYMBOL_FAMILY = (function () {
    var m = {};
    function fam(name, glyphs) {
      for (var i = 0; i < glyphs.length; i++) m[glyphs[i]] = name;
    }
    fam('dot', ['·', ':', '¤', '∴']);
    fam('round', ['○', '●', '◌', '◍', '∅']);
    fam('square', ['▫', '▪', '□', '■']);
    fam('tri', ['△', '▲', '▽', '▼', 'Δ', 'Λ']);
    fam('diamond', ['◇', '◆']);
    fam('star', ['☆', '★']);
    fam('cross', ['+', '×', '÷', '†', '‡']);
    fam('line', ['=', '≡', '~', '≈', '—', '‖', '|', '/', '\\', 'Ξ', 'Π']);
    fam('angle', ['^', 'v', '<', '>', '(', ')', '[', ']', '{', '}']);
    fam('letter', ['§', '¶', '¥', '£', '∞', 'Ω',
      'Σ', 'Ψ', 'Φ', 'Θ', 'ß', 'æ']);
    fam('digit', ['2', '3', '4', '5', '6', '7', '8', '9']);
    return m;
  })();

  function familyOf(sym) { return SYMBOL_FAMILY[sym] || 'alpha'; }

  /**
   * assignSymbols(palette, opts?) -> palette  (mutates .symbol in place)
   *
   * - lowest-ink glyphs go to the highest stitchCount colours,
   * - neighbouring shades (by L*) never share a glyph family,
   * - deterministic for a given palette.
   */
  function assignSymbols(palette, opts) {
    if (!Array.isArray(palette) || !palette.length) return palette;
    opts = isObj(opts) ? opts : {};
    var pool = Array.isArray(opts.symbols) && opts.symbols.length
      ? opts.symbols.slice()
      : SYMBOLS.concat(SYMBOLS_EXTRA);

    var n = palette.length;
    var i;

    /* Lightness order, for the "don't repeat a family next door" rule. */
    var light = [];
    for (i = 0; i < n; i++) {
      var lab = hexToLab(palette[i].hex);
      light.push({ i: i, L: lab ? lab[0] : 50 });
    }
    light.sort(function (a, b) { return a.L - b.L || a.i - b.i; });
    var pos = new Array(n);
    for (i = 0; i < n; i++) pos[light[i].i] = i;

    /* Ink priority: most stitches first. */
    var order = [];
    for (i = 0; i < n; i++) order.push({ i: i, c: num(palette[i].stitchCount, 0) || 0 });
    order.sort(function (a, b) { return b.c - a.c || a.i - b.i; });

    var assignedAt = new Array(n);      // by lightness position
    var used = {};
    /* Wave K (#1, 04 #7): with opts.distinct every shape family is used
       once before any family is used twice, so ten colours never come out
       as · ● ▪ : (two dots, two squares, two rounds). */
    var famUse = {}, distinct = !!opts.distinct;

    for (var k = 0; k < order.length; k++) {
      var idx = order[k].i;
      var p = pos[idx];
      var before = p > 0 ? assignedAt[p - 1] : null;
      var after = p < n - 1 ? assignedAt[p + 1] : null;
      var pick = null, fallback = null, bestUse = Infinity;
      for (var s = 0; s < pool.length; s++) {
        var g = pool[s];
        if (used[g]) continue;
        if (fallback === null) fallback = g;
        var f = familyOf(g);
        if (before && familyOf(before) === f) continue;
        if (after && familyOf(after) === f) continue;
        if (!distinct) { pick = g; break; }
        var fu = famUse[f] || 0;
        if (fu < bestUse) { bestUse = fu; pick = g; if (!fu) break; }
      }
      if (pick !== null) famUse[familyOf(pick)] = (famUse[familyOf(pick)] || 0) + 1;
      if (pick === null) pick = fallback;
      if (pick === null) pick = pool[(k % pool.length)];   // palette > pool: reuse
      else used[pick] = true;
      assignedAt[p] = pick;
      palette[idx].symbol = pick;
    }
    return palette;
  }

  /** Glyph ink colour for a swatch: L* < 50 -> light glyph, else dark. */
  function symbolInk(hex) {
    var lab = hexToLab(hex);
    return (lab && lab[0] < 50) ? 'light' : 'dark';
  }

  /* ================================================================== *
   * 5. Packing (B3.6)
   * ================================================================== */

  /**
   * packCells(cells, w, h) -> { enc: 'rle', data: '-1x7,3x12,...' }
   * `cells` may be an Int16Array or a plain array. -1 means an empty cell.
   */
  function packCells(cells, w, h) {
    var n = cells && cells.length ? cells.length : 0;
    if (typeof w === 'number' && typeof h === 'number' && w * h > 0 && w * h < n) n = w * h;
    if (!n) return { enc: 'rle', data: '' };
    var parts = [];
    var cur = cells[0] | 0, run = 1;
    for (var i = 1; i < n; i++) {
      var v = cells[i] | 0;
      if (v === cur) { run++; continue; }
      parts.push(cur + 'x' + run);
      cur = v; run = 1;
    }
    parts.push(cur + 'x' + run);
    return { enc: 'rle', data: parts.join(',') };
  }

  /**
   * unpackCells(packed) -> Int16Array
   * Accepts { enc:'rle', data } or the raw data string. A segment without an
   * 'x' is a run of one.
   */
  function unpackCells(packed) {
    var data = typeof packed === 'string' ? packed : (isObj(packed) ? str(packed.data, '') : '');
    if (!data) return new Int16Array(0);
    var segs = data.split(',');
    var total = 0, i, m;
    var vals = [], runs = [];
    for (i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (!s) continue;
      m = /^(-?\d+)(?:x(\d+))?$/.exec(s);
      if (!m) continue;
      var run = m[2] === undefined ? 1 : parseInt(m[2], 10);
      if (!(run > 0)) continue;
      vals.push(parseInt(m[1], 10));
      runs.push(run);
      total += run;
    }
    var out = new Int16Array(total);
    var at = 0;
    for (i = 0; i < vals.length; i++) {
      var v = vals[i], r = runs[i];
      for (var k = 0; k < r; k++) out[at++] = v;
    }
    return out;
  }

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var B64INV = (function () {
    var m = {};
    for (var i = 0; i < B64.length; i++) m[B64.charAt(i)] = i;
    return m;
  })();

  function bytesToB64(bytes) {
    var out = '', i, n = bytes.length;
    for (i = 0; i + 2 < n; i += 3) {
      var x = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64.charAt((x >> 18) & 63) + B64.charAt((x >> 12) & 63) +
             B64.charAt((x >> 6) & 63) + B64.charAt(x & 63);
    }
    var rem = n - i;
    if (rem === 1) {
      var a = bytes[i] << 16;
      out += B64.charAt((a >> 18) & 63) + B64.charAt((a >> 12) & 63) + '==';
    } else if (rem === 2) {
      var b = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += B64.charAt((b >> 18) & 63) + B64.charAt((b >> 12) & 63) +
             B64.charAt((b >> 6) & 63) + '=';
    }
    return out;
  }

  function b64ToBytes(s) {
    s = String(s == null ? '' : s).replace(/[^A-Za-z0-9+/=]/g, '');
    var pad = 0;
    while (s.length && s.charAt(s.length - 1) === '=') { pad++; s = s.slice(0, -1); }
    var n = Math.floor(s.length * 3 / 4);
    var out = new Uint8Array(n);
    var at = 0, buf = 0, bits = 0;
    for (var i = 0; i < s.length; i++) {
      var v = B64INV[s.charAt(i)];
      if (v === undefined) continue;
      buf = (buf << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        if (at < n) out[at++] = (buf >> bits) & 255;
      }
    }
    return out;
  }

  /**
   * packBits(bits, n) -> base64 of ceil(n/8) bytes.
   * `bits` is an array-like of n truthy/falsy values, one per bit.
   * Bit i lives in byte i>>3 at mask 1<<(i&7).
   */
  function packBits(bits, n) {
    n = clampInt(n, 0, 1e9, bits && bits.length ? bits.length : 0);
    var bytes = new Uint8Array(Math.ceil(n / 8));
    if (bits) {
      for (var i = 0; i < n; i++) {
        if (bits[i]) bytes[i >> 3] |= (1 << (i & 7));
      }
    }
    return bytesToB64(bytes);
  }

  /** unpackBits(b64, n) -> Uint8Array of n 0/1 values. */
  function unpackBits(b64, n) {
    var bytes = b64ToBytes(b64);
    n = clampInt(n, 0, 1e9, bytes.length * 8);
    var out = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var by = bytes[i >> 3];
      out[i] = by === undefined ? 0 : ((by >> (i & 7)) & 1);
    }
    return out;
  }

  /**
   * getBit(b64OrState, i) -> boolean
   * Decodes only the byte it needs, so it is O(1) on a 33 kB bitmap.
   */
  function getBit(b64OrState, i) {
    i = clampInt(i, 0, 1e9, -1);
    if (i < 0) return false;
    var byteIdx = i >> 3;
    var bytes = null;
    if (isObj(b64OrState) && b64OrState.bytes) bytes = b64OrState.bytes;
    if (bytes) return ((bytes[byteIdx] || 0) >> (i & 7) & 1) === 1;

    var s = isObj(b64OrState) ? str(b64OrState.b64, '') : String(b64OrState == null ? '' : b64OrState);
    s = s.replace(/[^A-Za-z0-9+/]/g, '');
    var group = Math.floor(byteIdx / 3);
    var chars = s.substr(group * 4, 4);
    if (!chars) return false;
    var buf = 0, have = 0, got = [];
    for (var k = 0; k < chars.length; k++) {
      var v = B64INV[chars.charAt(k)];
      if (v === undefined) continue;
      buf = (buf << 6) | v; have += 6;
      if (have >= 8) { have -= 8; got.push((buf >> have) & 255); }
    }
    var by = got[byteIdx - group * 3];
    if (by === undefined) return false;
    return ((by >> (i & 7)) & 1) === 1;
  }

  /**
   * bitsState(b64, n) -> { b64, bytes: Uint8Array, n, dirty:false }
   * The mutable companion to setBit: decode once, flip bits cheaply, then
   * call bitsB64(state) to get the string to store.
   */
  function bitsState(b64, n) {
    var bytes = b64ToBytes(b64);
    var need = Math.ceil(clampInt(n, 0, 1e9, bytes.length * 8) / 8);
    if (bytes.length < need) {
      var grown = new Uint8Array(need);
      grown.set(bytes);
      bytes = grown;
    }
    return { b64: str(b64, ''), bytes: bytes, n: clampInt(n, 0, 1e9, bytes.length * 8), dirty: false };
  }

  /**
   * setBit(state, i, v) -> state
   * `state` is a bitsState(); a bare base64 string is accepted and upgraded.
   * Marks the state dirty; call bitsB64(state) to re-encode.
   */
  function setBit(state, i, v) {
    if (!isObj(state) || !state.bytes) state = bitsState(typeof state === 'string' ? state : '', undefined);
    i = clampInt(i, 0, 1e9, -1);
    if (i < 0) return state;
    var byteIdx = i >> 3;
    if (byteIdx >= state.bytes.length) {
      var grown = new Uint8Array(byteIdx + 1);
      grown.set(state.bytes);
      state.bytes = grown;
    }
    var mask = 1 << (i & 7);
    var was = (state.bytes[byteIdx] & mask) !== 0;
    if (v) state.bytes[byteIdx] |= mask;
    else state.bytes[byteIdx] &= ~mask;
    if (was !== !!v) state.dirty = true;
    return state;
  }

  /** bitsB64(state) -> base64, re-encoding only when the state is dirty. */
  function bitsB64(state) {
    if (!isObj(state)) return str(state, '');
    if (state.dirty || !state.b64) {
      state.b64 = bytesToB64(state.bytes || new Uint8Array(0));
      state.dirty = false;
    }
    return state.b64;
  }

  /**
   * refitBits(b64, n) -> base64 holding exactly n bits.
   * Anything past bit n-1 is dropped and anything missing reads as 0, so a
   * bitmap kept from an older, differently sized chart cannot mark the wrong
   * items. An all-zero result is stored as '' to keep craftData small.
   */
  function refitBits(b64, n) {
    if (!(n > 0)) return '';
    var s = str(b64, '');
    if (!s) return '';
    var bits = unpackBits(s, n);
    var any = false;
    for (var i = 0; i < n; i++) if (bits[i]) { any = true; break; }
    return any ? packBits(bits, n) : '';
  }

  /** popcount over the first n bits of a base64 bitmap. */
  function countBits(b64, n) {
    var bytes = b64ToBytes(b64);
    n = clampInt(n, 0, 1e9, bytes.length * 8);
    var total = 0;
    var full = n >> 3;
    for (var i = 0; i < full && i < bytes.length; i++) {
      var v = bytes[i];
      v = v - ((v >> 1) & 0x55);
      v = (v & 0x33) + ((v >> 2) & 0x33);
      total += (v + (v >> 4)) & 0x0f;
    }
    for (var b = full << 3; b < n; b++) {
      var by = bytes[b >> 3];
      if (by !== undefined && ((by >> (b & 7)) & 1)) total++;
    }
    return total;
  }

  /* ================================================================== *
   * 6. Geometry and floss maths (B3.6)
   * ================================================================== */

  var CM_PER_IN = 2.54;
  var MARGIN_IN = 6;          // +3 in per side for framing (A2.3)

  function effectiveCount(count, over) {
    var c = num(count, 14);
    var o = num(over, 1);
    if (!(c > 0)) c = 14;
    if (!(o > 0)) o = 1;
    return c / o;
  }

  /**
   * finishedSize({ w, h, count, over }) ->
   *   { wIn, hIn, wCm, hCm, fabricIn: { w, h }, fabricCm: { w, h } }
   */
  function finishedSize(o) {
    o = isObj(o) ? o : {};
    var w = num(o.w, 0), h = num(o.h, 0);
    var c = effectiveCount(o.count, o.over);
    var wIn = w > 0 ? w / c : 0;
    var hIn = h > 0 ? h / c : 0;
    return {
      wIn: round2(wIn),
      hIn: round2(hIn),
      wCm: round1(wIn * CM_PER_IN),
      hCm: round1(hIn * CM_PER_IN),
      fabricIn: { w: round2(wIn + MARGIN_IN), h: round2(hIn + MARGIN_IN) },
      fabricCm: { w: round1((wIn + MARGIN_IN) * CM_PER_IN), h: round1((hIn + MARGIN_IN) * CM_PER_IN) }
    };
  }

  /** sizeTable({ w, h, over }, counts) -> [{ count, wIn, hIn }] */
  function sizeTable(design, counts) {
    design = isObj(design) ? design : {};
    if (!Array.isArray(counts) || !counts.length) counts = [14, 16, 18];
    var out = [];
    for (var i = 0; i < counts.length; i++) {
      var c = num(counts[i], 0);
      if (!(c > 0)) continue;
      var s = finishedSize({ w: design.w, h: design.h, count: c, over: design.over });
      out.push({ count: c, wIn: s.wIn, hIn: s.hIn });
    }
    return out;
  }

  /**
   * lengthPerStitchCm(count, over) -> cm of 1-strand-equivalent floss for one
   * full cross. 2.50 cm at 14 ct, scaled by the effective count (A3.2 step 9).
   */
  function lengthPerStitchCm(count, over) {
    var c = effectiveCount(count, over);
    return round2(2.50 * 14 / c);
  }

  var SKEIN_CM = 800;          // a DMC skein is ~8 m of 6-strand floss
  var SKEIN_STRANDS = 6;
  /* Published yields at 14 ct / 2 strands run from ~960 (no waste) down to
     ~800 with 20% waste, and up to ~1785 for a frugal stitcher. skeinRange
     uses that spread rather than pretending to one number. */
  var SKEIN_SPREAD = 1785 / 800;

  function usableCm(strands) {
    var s = num(strands, 2);
    if (!(s > 0)) s = 2;
    return SKEIN_CM * SKEIN_STRANDS / s;
  }

  /**
   * skeinsFor({ stitchCount, count, over, strands, waste = 0.2 }) -> integer
   *   skeins = ceil( stitches * lenPerStitch * (1 + waste) / (800 * 6/strands) )
   */
  function skeinsFor(o) {
    o = isObj(o) ? o : {};
    var stitches = num(o.stitchCount, 0);
    if (!(stitches > 0)) return 0;
    var waste = num(o.waste, 0.2);
    if (!(waste >= 0)) waste = 0;
    var len = lengthPerStitchCm(o.count, o.over);
    var need = stitches * len * (1 + waste);
    var per = usableCm(o.strands);
    var n = Math.ceil(need / per);
    return n < 1 ? 1 : n;
  }

  /**
   * skeinRange(args) -> { low, high, mid } — an honest range, not false
   * precision. Wave K: `mid` is the count at the geometric middle of the
   * published yields (the "buy N" a stitcher can act on).
   */
  function skeinRange(o) {
    o = isObj(o) ? o : {};
    var high = skeinsFor(o);
    if (!high) return { low: 0, high: 0, mid: 0 };
    var stitches = num(o.stitchCount, 0);
    var waste = num(o.waste, 0.2);
    if (!(waste >= 0)) waste = 0;
    var len = lengthPerStitchCm(o.count, o.over);
    var per = usableCm(o.strands) * SKEIN_SPREAD;
    var low = Math.ceil(stitches * len * (1 + waste) / per);
    if (low < 1) low = 1;
    if (low > high) low = high;
    var mid = Math.ceil(stitches * len * (1 + waste) / (usableCm(o.strands) * Math.sqrt(SKEIN_SPREAD)));
    if (mid < low) mid = low;
    if (mid > high) mid = high;
    return { low: low, high: high, mid: mid };
  }

  /* ---- confetti ---------------------------------------------------- */

  function chartCells(chart) {
    if (!isObj(chart)) return null;
    var w = clampInt(chart.w, 0, 20000, 0), h = clampInt(chart.h, 0, 20000, 0);
    if (!w || !h) return null;
    var cells = chart.cells;
    if (cells && typeof cells.length === 'number' && typeof cells !== 'string') {
      // already an array / typed array
      return { w: w, h: h, cells: cells };
    }
    var un = unpackCells(cells);
    if (un.length < w * h) {
      var grown = new Int16Array(w * h);
      grown.fill ? grown.fill(-1) : (function () { for (var i = 0; i < grown.length; i++) grown[i] = -1; })();
      grown.set(un.subarray ? un.subarray(0, Math.min(un.length, grown.length)) : un);
      un = grown;
    }
    return { w: w, h: h, cells: un };
  }

  /**
   * confetti(chart) -> { total, byColor: { [i]: n }, byPage: [] }
   * A confetti stitch is a size-1 8-connected component: a filled cell with no
   * 8-neighbour of the same colour.
   */
  function confetti(chart) {
    var c = chartCells(chart);
    var res = { total: 0, byColor: {}, byPage: [] };
    if (!c) return res;
    var w = c.w, h = c.h, cells = c.cells;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var v = cells[y * w + x];
        if (v < 0) continue;
        var alone = true;
        for (var dy = -1; dy <= 1 && alone; dy++) {
          var ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (var dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            var nx = x + dx;
            if (nx < 0 || nx >= w) continue;
            if (cells[ny * w + nx] === v) { alone = false; break; }
          }
        }
        if (alone) {
          res.total++;
          res.byColor[v] = (res.byColor[v] || 0) + 1;
        }
      }
    }
    return res;
  }

  /**
   * progressStats(data) -> {
   *   done, total, pct,
   *   byColor: [{ i, done, total, back, knots, part, complete }],
   *   breakdown: { cross, part, back, knots }
   * }
   *
   * `done` / `total` / `pct` cover the whole piece: one per full cross, one per
   * fractional stitch, one per knot or bead and one per backstitch segment.
   * `breakdown` splits that four ways, each as `{ done, total }`.
   *
   * `byColor[i].done` / `.total` stay CROSSES ONLY — the tap button, the group
   * readout and the "412 left" line all count crosses — with the three extra
   * layers in their own `{ done, total }` sub-objects and `complete` true when
   * every layer of that colour is finished.
   *
   * A part stitch with two palette indexes counts once towards each of them in
   * `byColor` (it is half of each colour's work) but only once in the totals.
   *
   * Works in both 'cells' and 'counts' mode; the three extra layers only exist
   * alongside a cell chart.
   */
  function blankTally() { return { done: 0, total: 0 }; }

  function progressStats(data) {
    data = isObj(data) ? data : {};
    var palette = Array.isArray(data.palette) ? data.palette : [];
    var progress = isObj(data.progress) ? data.progress : {};
    var byColor = [];
    var i;
    var breakdown = { cross: blankTally(), part: blankTally(), back: blankTally(), knots: blankTally() };

    for (i = 0; i < palette.length; i++) {
      byColor.push({
        i: num(palette[i].i, i), done: 0, total: 0,
        back: blankTally(), knots: blankTally(), part: blankTally(), complete: false
      });
    }

    var c = progress.mode === 'cells' ? chartCells(data.chart) : null;
    if (c) {
      var n = c.w * c.h;
      var bits = unpackBits(str(progress.done, ''), n);
      for (i = 0; i < n; i++) {
        var v = c.cells[i];
        if (v < 0) continue;
        breakdown.cross.total++;
        if (v < byColor.length) byColor[v].total++;
        if (bits[i]) {
          breakdown.cross.done++;
          if (v < byColor.length) byColor[v].done++;
        }
      }
    } else {
      var per = Array.isArray(progress.perColor) ? progress.perColor : [];
      for (i = 0; i < palette.length; i++) {
        var t = clampInt(palette[i].stitchCount, 0, 1e9, 0);
        var d = 0;
        for (var k = 0; k < per.length; k++) {
          if (clampInt(per[k].i, 0, 1e9, -1) === num(palette[i].i, i)) { d = clampInt(per[k].done, 0, 1e9, 0); break; }
        }
        if (t && d > t) d = t;
        breakdown.cross.total += t;
        breakdown.cross.done += d;
        byColor[i].done = d;
        byColor[i].total = t;
      }
    }

    /* backstitch, knots/beads and fractionals: one bit per list entry */
    var chart = c ? data.chart : null;
    if (chart) {
      var back = Array.isArray(chart.back) ? chart.back : [];
      var bb = unpackBits(str(progress.doneBack, ''), back.length);
      for (i = 0; i < back.length; i++) {
        var bd = bb[i] ? 1 : 0;
        breakdown.back.total++;
        breakdown.back.done += bd;
        var bi = clampInt(back[i].i, -1, 9999, -1);
        if (bi >= 0 && bi < byColor.length) { byColor[bi].back.total++; byColor[bi].back.done += bd; }
      }

      var knots = Array.isArray(chart.knots) ? chart.knots : [];
      var kb = unpackBits(str(progress.doneKnots, ''), knots.length);
      for (i = 0; i < knots.length; i++) {
        var kd = kb[i] ? 1 : 0;
        breakdown.knots.total++;
        breakdown.knots.done += kd;
        var ki = clampInt(knots[i].i, -1, 9999, -1);
        if (ki >= 0 && ki < byColor.length) { byColor[ki].knots.total++; byColor[ki].knots.done += kd; }
      }

      var part = Array.isArray(chart.part) ? chart.part : [];
      var pb = unpackBits(str(progress.donePart, ''), part.length);
      for (i = 0; i < part.length; i++) {
        var pd = pb[i] ? 1 : 0;
        breakdown.part.total++;
        breakdown.part.done += pd;
        var pa = clampInt(part[i].a, -1, 9999, -1);
        var pbb = clampInt(part[i].b, -1, 9999, -1);
        if (pa >= 0 && pa < byColor.length) { byColor[pa].part.total++; byColor[pa].part.done += pd; }
        if (pbb >= 0 && pbb !== pa && pbb < byColor.length) { byColor[pbb].part.total++; byColor[pbb].part.done += pd; }
      }
    }

    for (i = 0; i < byColor.length; i++) {
      var e = byColor[i];
      var eTotal = e.total + e.back.total + e.knots.total + e.part.total;
      var eDone = e.done + e.back.done + e.knots.done + e.part.done;
      e.complete = eTotal > 0 && eDone >= eTotal;
    }

    var done = breakdown.cross.done + breakdown.part.done + breakdown.back.done + breakdown.knots.done;
    var total = breakdown.cross.total + breakdown.part.total + breakdown.back.total + breakdown.knots.total;

    return {
      done: done,
      total: total,
      pct: total > 0 ? Math.round(done / total * 100) : 0,
      byColor: byColor,
      breakdown: breakdown
    };
  }

  /* ---- hit tests for the three extra layers (B5.2 mark tools) ------- */

  var HIT_TOL = 0.35;          // fraction of a cell

  function dist2(ax, ay, bx, by) {
    var dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  }

  /**
   * nearestBack(chart, x, y, tol) -> index into chart.back, or -1.
   * `x`/`y` are chart coordinates in cells; the backstitch lattice runs on the
   * cell corners, so 3.5 is the middle of the fourth column. A segment counts
   * as hit when the point is within `tol` cells (default 0.35) of one of its
   * endpoints or of its midpoint — the three places a fingertip lands. The
   * closest of the candidates wins, and ties keep the earlier segment.
   */
  function nearestBack(chart, x, y, tol) {
    var list = isObj(chart) && Array.isArray(chart.back) ? chart.back : [];
    var t = num(tol, HIT_TOL);
    if (!(t > 0)) t = HIT_TOL;
    var px = num(x, NaN), py = num(y, NaN);
    if (!isFinite(px) || !isFinite(py)) return -1;
    var best = -1, bestD = t * t * (1 + 1e-9);
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      var d = Math.min(
        dist2(px, py, b.x1, b.y1),
        dist2(px, py, b.x2, b.y2),
        dist2(px, py, (b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2)
      );
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /** nearestKnot(chart, x, y, tol) -> index into chart.knots, or -1. */
  function nearestKnot(chart, x, y, tol) {
    var list = isObj(chart) && Array.isArray(chart.knots) ? chart.knots : [];
    var t = num(tol, HIT_TOL);
    if (!(t > 0)) t = HIT_TOL;
    var px = num(x, NaN), py = num(y, NaN);
    if (!isFinite(px) || !isFinite(py)) return -1;
    var best = -1, bestD = t * t * (1 + 1e-9);
    for (var i = 0; i < list.length; i++) {
      var d = dist2(px, py, list[i].x, list[i].y);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /**
   * nearestPart(chart, x, y) -> index into chart.part, or -1.
   * Fractionals sit inside a cell rather than on the lattice, so this is plain
   * cell containment: whichever part stitch lives in the tapped square.
   */
  function nearestPart(chart, x, y) {
    var list = isObj(chart) && Array.isArray(chart.part) ? chart.part : [];
    var px = num(x, NaN), py = num(y, NaN);
    if (!isFinite(px) || !isFinite(py)) return -1;
    var cx = Math.floor(px), cy = Math.floor(py);
    for (var i = 0; i < list.length; i++) {
      if (list[i].x === cx && list[i].y === cy) return i;
    }
    return -1;
  }

  /* ---- what the big tap button is counting right now ---------------- */

  var TAP_ORDER = ['cross', 'back', 'knots', 'part'];
  var TAP_CAPTIONS = { cross: 'STITCHES', back: 'BACKSTITCH', knots: 'KNOTS', part: 'PARTS' };

  /**
   * tapLayer(colorStat) -> 'cross' | 'back' | 'knots' | 'part' | null
   *
   * The layer the big tap button should advance through for one colour: full
   * crosses until they are gone, then backstitch, then knots and beads, then
   * fractionals; null when that colour has nothing left at all.
   *
   * `colorStat` is one entry of progressStats().byColor. A whole stats object
   * or a whole XSData plus a palette index work too, so callers that already
   * hold cached stats never have to recount.
   */
  function tapLayer(colorStat, pi) {
    var s = colorStat;
    if (isObj(s) && Array.isArray(s.byColor)) s = s.byColor[clampInt(pi, 0, 9999, 0)];
    else if (isObj(s) && Array.isArray(s.palette)) s = progressStats(s).byColor[clampInt(pi, 0, 9999, 0)];
    if (!isObj(s)) return null;
    if (num(s.total, 0) > num(s.done, 0)) return 'cross';
    for (var i = 1; i < TAP_ORDER.length; i++) {
      var sub = s[TAP_ORDER[i]];
      if (isObj(sub) && num(sub.total, 0) > num(sub.done, 0)) return TAP_ORDER[i];
    }
    return null;
  }

  /** tapCaption(layer) -> the word on the big button. */
  function tapCaption(layer) {
    return TAP_CAPTIONS[layer] || TAP_CAPTIONS.cross;
  }

  /* ---- craftData size guard (research doc B9 risk #4) --------------- */

  var SIZE_WARN_BYTES = 1048576;      // 1 MB
  var SIZE_BUDGET_BYTES = 5242880;    // the ~5 MB localStorage gets per origin

  /**
   * dataSize(craftData) -> bytes.
   * The length of the JSON the shell will hand to localStorage for this
   * project. Everything heavy in here (RLE cells, base64 bitmaps, floss codes)
   * is ASCII, so the string length is the byte count; a non-ASCII title can
   * make the real figure a byte or two larger, which never matters at the 1 MB
   * scale this guards.
   */
  function dataSize(craftData) {
    var s;
    try { s = JSON.stringify(craftData === undefined ? null : craftData); }
    catch (e) { return 0; }
    return typeof s === 'string' ? s.length : 0;
  }

  /**
   * toCountsMode(data) -> XSData with the cell grid dropped.
   *
   * The escape hatch when craftData gets too big for localStorage: chart page
   * images, the palette and the per-colour tallies all survive, per-stitch
   * tracking does not. The tallies are read out of the bitmaps BEFORE the
   * chart goes, so "412 of 1,234 done" is still true afterwards, and any
   * palette entry without a stitch count inherits the one the chart implied.
   */
  function toCountsMode(data) {
    var d = normalize(data, null);
    var st = progressStats(d);
    var perColor = [], totalDone = 0, i;
    for (i = 0; i < d.palette.length; i++) {
      var c = st.byColor[i] || { done: 0, total: 0 };
      if (!d.palette[i].stitchCount && c.total) d.palette[i].stitchCount = c.total;
      perColor.push({ i: i, done: c.done });
      totalDone += c.done;
    }
    d.chart = null;
    d.progress.mode = 'counts';
    d.progress.done = '';
    d.progress.doneBack = '';
    d.progress.doneBackCount = 0;
    d.progress.donePart = '';
    d.progress.donePartCount = 0;
    d.progress.doneKnots = '';
    d.progress.doneKnotsCount = 0;
    d.progress.perColor = perColor;
    d.progress.doneCount = totalDone;
    return normalize(d, null);
  }

  /* ================================================================== *
   * 7. Craft plumbing (B3.1)
   * ================================================================== */

  var FABRIC_KINDS = { aida: 1, evenweave: 1, linen: 1 };
  var PALETTE_KINDS = { cross: 1, back: 1, knot: 1, bead: 1, half: 1, blend: 1 };
  var SOURCE_KINDS = { oxs: 1, pdf: 1, photo: 1, manual: 1, picture: 1 };
  var CHECK_VERDICTS = { exact: 1, close: 1, off: 1, unchecked: 1 };

  function countOrNull(v) {
    return typeof v === 'number' && isFinite(v) && v >= 0 ? Math.min(Math.round(v), 1e9) : null;
  }

  /**
   * Wave J: source.check, the banner's copy of a Check (CONTRACT §3) as the
   * app stores it: { verdict, summary, readTotal, expectedTotal, off,
   * colours }. Nothing else is kept, strings are capped, numbers finite.
   */
  function normalizeSourceCheck(c) {
    if (!isObj(c)) return null;
    return {
      verdict: CHECK_VERDICTS[c.verdict] ? c.verdict : 'unchecked',
      summary: str(c.summary, '').replace(/\s+/g, ' ').trim().slice(0, 400),
      readTotal: countOrNull(c.readTotal),
      expectedTotal: countOrNull(c.expectedTotal),
      off: countOrNull(c.off) === null ? 0 : Math.min(countOrNull(c.off), 9999),
      colours: countOrNull(c.colours) === null ? null : Math.min(countOrNull(c.colours), 9999)
    };
  }

  /**
   * Wave J: current.rowOpts, the Row by row options (app-xstitch.js
   * normRowOpts: { from, dir, one, skipEmpty }, defaults top / ltr / false /
   * true). A `color` (palette index or null) is kept only when one was
   * stored, and dropped to null when it is not a palette index.
   */
  function normalizeRowOpts(v, nPalette) {
    if (!isObj(v)) return null;
    var out = {
      from: v.from === 'bottom' ? 'bottom' : 'top',
      dir: v.dir === 'serpentine' ? 'serpentine' : 'ltr',
      one: v.one === true,
      skipEmpty: v.skipEmpty !== false
    };
    if (Object.prototype.hasOwnProperty.call(v, 'color')) {
      var c = v.color;
      out.color = typeof c === 'number' && isFinite(c) && c >= 0 && c < nPalette && Math.floor(c) === c ? c : null;
    }
    return out;
  }
  var BRANDS = ['DMC', 'Anchor', 'Madeira', 'Cosmo', 'Olympus', 'Sullivans'];

  function canonBrand(word) {
    var w = String(word == null ? '' : word).trim().toLowerCase();
    for (var i = 0; i < BRANDS.length; i++) {
      if (BRANDS[i].toLowerCase() === w) return BRANDS[i];
    }
    return '';
  }

  function normHex(v, dflt) {
    var h = String(v == null ? '' : v).replace(/^#/, '').trim().toLowerCase();
    return /^[0-9a-f]{6}$/.test(h) ? h : dflt;
  }

  function normalizePaletteEntry(raw, i, strandsDefault) {
    raw = isObj(raw) ? raw : {};
    var brand = canonBrand(raw.brand);
    var code = str(raw.code, '').trim();
    var hex = normHex(raw.hex, null);
    if (!hex) hex = hexFor(brand || 'DMC', code) || '808080';
    var kind = PALETTE_KINDS[raw.kind] ? raw.kind : 'cross';
    var name = str(raw.name, '').trim();
    if (!name) {
      var f = flossFor(brand || 'DMC', code);
      if (f) name = f.name;
    }
    var out = {
      i: clampInt(raw.i, 0, 9999, i),
      symbol: str(raw.symbol, ''),
      brand: brand,
      code: code,
      name: name,
      hex: hex,
      strands: clampInt(raw.strands, 1, 12, strandsDefault),
      bsStrands: clampInt(raw.bsStrands, 1, 12, 1),
      kind: kind,
      blendWith: raw.blendWith === null || raw.blendWith === undefined
        ? null : clampInt(raw.blendWith, 0, 9999, null),
      stitchCount: raw.stitchCount === null || raw.stitchCount === undefined
        ? 0 : clampInt(raw.stitchCount, 0, 1e9, 0),
      skeins: raw.skeins === null || raw.skeins === undefined
        ? 0 : clampInt(raw.skeins, 0, 9999, 0),
      have: !!raw.have
    };
    /* Wave K: each kept only when present, so older saves normalise
       byte for byte as before. */
    /* a printed 0 stays 0 (it was clamped up to 1 before the audit's D21);
       an absent or unreadable count stays absent */
    if (typeof raw.keyCount === 'number' && isFinite(raw.keyCount) && raw.keyCount >= 0) {
      out.keyCount = clampInt(raw.keyCount, 0, 1e9, 0);
    }
    if (Array.isArray(raw.unresolved)) {
      var ur = [];
      for (var u = 0; u < raw.unresolved.length && ur.length < 16; u++) {
        var uv = clampInt(raw.unresolved[u], 0, 9999, -1);
        if (uv >= 0 && ur.indexOf(uv) < 0) ur.push(uv);
      }
      out.unresolved = ur;
    }
    var gl = normalizeGlyph(raw.glyph);
    if (gl) out.glyph = gl;
    return out;
  }

  var GLYPH_SOURCES = { 'pdf-path': 1, 'pdf-font': 1, picture: 1, user: 1 };

  /**
   * palette[i].glyph = { w, h, bits, path, clean, source } (R5; the shape of
   * XSKeyRead's Glyph). bits: base64 of w*h bits (row-major from the top),
   * at most 32 x 32; path: an SVG path in a 100 x 100 box, at most 1 KB.
   */
  function normalizeGlyph(g) {
    if (!isObj(g)) return null;
    var w = clampInt(g.w, 4, 32, 0), h = clampInt(g.h, 4, 32, 0);
    var bits = str(g.bits, '').replace(/[^A-Za-z0-9+/=]/g, '');
    var path = str(g.path, '');
    if (!/^[MLHVCQZmlhvcqz0-9 .,\-]*$/.test(path) || path.length > 1024) path = '';
    if ((!w || !h || !bits || bits.length > Math.ceil(w * h / 8 / 3) * 4 + 4) && !path) return null;
    return {
      w: w || 16, h: h || 16,
      bits: w && h && bits.length <= Math.ceil(w * h / 8 / 3) * 4 + 4 ? bits : '',
      path: path || null,
      clean: g.clean === true,
      source: GLYPH_SOURCES[g.source] ? g.source : 'user'
    };
  }

  function normalizeChart(raw, warnings) {
    if (!isObj(raw)) return null;
    var w = clampInt(raw.w, 1, 20000, 0);
    var h = clampInt(raw.h, 1, 20000, 0);
    if (!w || !h) return null;

    var cells = raw.cells;
    var packed;
    if (isObj(cells) && typeof cells.data === 'string') {
      packed = { enc: 'rle', data: cells.data };
    } else if (typeof cells === 'string') {
      packed = { enc: 'rle', data: cells };
    } else if (cells && typeof cells.length === 'number') {
      packed = packCells(cells, w, h);
    } else {
      var empty = new Int16Array(w * h);
      for (var e = 0; e < empty.length; e++) empty[e] = -1;
      packed = packCells(empty, w, h);
    }

    var part = [], back = [], knots = [], i;
    if (Array.isArray(raw.part)) {
      for (i = 0; i < raw.part.length; i++) {
        var p = raw.part[i];
        if (!isObj(p)) continue;
        part.push({
          x: clampInt(p.x, 0, 20000, 0), y: clampInt(p.y, 0, 20000, 0),
          a: clampInt(p.a, -1, 9999, -1), b: clampInt(p.b, -1, 9999, -1),
          d: clampInt(p.d, 1, 4, 1)
        });
      }
    }
    if (Array.isArray(raw.back)) {
      for (i = 0; i < raw.back.length; i++) {
        var bs = raw.back[i];
        if (!isObj(bs)) continue;
        back.push({
          x1: num(bs.x1, 0), y1: num(bs.y1, 0),
          x2: num(bs.x2, 0), y2: num(bs.y2, 0),
          i: clampInt(bs.i, -1, 9999, -1)
        });
      }
    }
    if (Array.isArray(raw.knots)) {
      for (i = 0; i < raw.knots.length; i++) {
        var k = raw.knots[i];
        if (!isObj(k)) continue;
        knots.push({
          x: num(k.x, 0), y: num(k.y, 0),
          i: clampInt(k.i, -1, 9999, -1),
          t: k.t === 'bead' ? 'bead' : 'knot'
        });
      }
    }
    if (warnings && w * h > 500000) pushOnce(warnings, 'very large chart');
    return { w: w, h: h, cells: packed, part: part, back: back, knots: knots };
  }

  /* ---- wave F: chart position, remembered views, page regions -------- */

  /** The full chart's mark tools and layers (app-xstitch.js TOOLS / LAYER_DEFS). */
  var CHART_TOOLS = { tap: 1, paint: 1, block: 1, page: 1 };
  var CHART_LAYERS = { cross: 1, back: 1, knots: 1, part: 1 };

  /** Most CSS px a stitch is ever drawn at (the chart view's zoom ceiling). */
  var VIEW_MAX_Z = 64;

  /**
   * current.view = { z, x, y } | null — the full chart's zoom in CSS px per
   * stitch and the stitch (fractional, chart space) at the middle of the
   * canvas. Device independent: the app clamps z to "at least Fit" for the
   * canvas it is restored into, so a rotate or another phone never restores
   * an off-screen view (04 #2 risk note).
   */
  function normalizeView(v, chart) {
    if (!isObj(v)) return null;
    var z = num(v.z, NaN), x = num(v.x, NaN), y = num(v.y, NaN);
    if (!(z > 0) || !isFinite(x) || !isFinite(y)) return null;
    z = Math.min(VIEW_MAX_Z, z);
    if (chart && chart.w && chart.h) {
      x = Math.max(0, Math.min(chart.w, x));
      y = Math.max(0, Math.min(chart.h, y));
    }
    return { z: Math.round(z * 1000) / 1000, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
  }

  /**
   * pages[i].region = { x, y, w, h, fx, fy, fw, fh } | null
   *   x, y, w, h      the stitches this page prints, in chart cells
   *   fx, fy, fw, fh  where those stitches sit on the page, as fractions of
   *                   the page's width and height (null when unknown)
   */
  function normalizeRegion(r) {
    if (!isObj(r)) return null;
    var x = clampInt(r.x, 0, 20000, -1), y = clampInt(r.y, 0, 20000, -1);
    var w = clampInt(r.w, 1, 20000, 0), h = clampInt(r.h, 1, 20000, 0);
    if (x < 0 || y < 0 || !w || !h) return null;
    var out = { x: x, y: y, w: w, h: h, fx: null, fy: null, fw: null, fh: null };
    var fx = num(r.fx, NaN), fy = num(r.fy, NaN), fw = num(r.fw, NaN), fh = num(r.fh, NaN);
    if (isFinite(fx) && isFinite(fy) && fw > 0 && fh > 0 &&
        fx > -0.05 && fy > -0.05 && fx + fw < 1.05 && fy + fh < 1.05) {
      var r4 = function (v) { return Math.round(v * 10000) / 10000; };
      out.fx = r4(fx); out.fy = r4(fy); out.fw = r4(fw); out.fh = r4(fh);
    }
    return out;
  }

  /**
   * centreOffset(i, n) -> { k, side }
   * How far stitch `i` (0-based) of `n` sits from the centre arrows, counted
   * the way a printed chart is: the centre of an even count is the line
   * between its two middle stitches, so the stitch either side is 1; the
   * centre of an odd count is the middle stitch itself, which is 0.
   * side is 'before' (left / above), 'after' (right / below) or 'centre'.
   */
  function centreOffset(i, n) {
    i = clampInt(i, 0, Math.max(0, n - 1), 0);
    n = clampInt(n, 1, 100000, 1);
    if (n % 2 === 0) {
      var half = n / 2;
      return i >= half ? { k: i - half + 1, side: 'after' } : { k: half - i, side: 'before' };
    }
    var m = (n - 1) / 2;
    if (i === m) return { k: 0, side: 'centre' };
    return i > m ? { k: i - m, side: 'after' } : { k: m - i, side: 'before' };
  }

  /**
   * positionLabel(x, y, w, h) -> { col, row, grid, centre, block, text }
   * The readout under the chart: 'col 134 · row 57' counted from the
   * top-left (1-based, as the rulers print it) and '22 right · 15 up' from
   * the centre arrows.
   */
  function positionLabel(x, y, w, h) {
    var col = clampInt(x, 0, Math.max(0, w - 1), 0) + 1;
    var row = clampInt(y, 0, Math.max(0, h - 1), 0) + 1;
    var ox = centreOffset(col - 1, w), oy = centreOffset(row - 1, h);
    var cx = ox.side === 'centre' ? 'on the centre column'
      : ox.k + (ox.side === 'after' ? ' right' : ' left');
    var cy = oy.side === 'centre' ? 'on the centre row'
      : oy.k + (oy.side === 'after' ? ' down' : ' up');
    var centre = (ox.side === 'centre' && oy.side === 'centre')
      ? 'the centre stitch'
      : cx + ' · ' + cy + ' from centre';
    var grid = 'col ' + col + ' · row ' + row;
    var block = 'block ' + (Math.floor((col - 1) / 10) + 1) + ',' + (Math.floor((row - 1) / 10) + 1);
    return { col: col, row: row, grid: grid, centre: centre, block: block, text: grid + ' · ' + centre };
  }

  /**
   * rulerStep(z, minPx) -> stitches between ruler numbers: 10 when ten
   * stitches are at least `minPx` wide on screen, else 20, 50, 100, ... so
   * the numbers never collide at any zoom.
   */
  function rulerStep(z, minPx) {
    minPx = num(minPx, 28);
    var steps = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
    for (var i = 0; i < steps.length; i++) if (steps[i] * z >= minPx) return steps[i];
    return 20000;
  }

  /**
   * pageForCell(pages, x, y) -> index into pages, or -1
   * The page whose region holds stitch (x, y); when none does, the page whose
   * region is nearest to it.
   */
  function pageForCell(pages, x, y) {
    if (!Array.isArray(pages)) return -1;
    var best = -1, bestD = Infinity;
    for (var i = 0; i < pages.length; i++) {
      var r = pages[i] && pages[i].region;
      if (!r) continue;
      var dx = x < r.x ? r.x - x : (x >= r.x + r.w ? x - (r.x + r.w - 1) : 0);
      var dy = y < r.y ? r.y - y : (y >= r.y + r.h ? y - (r.y + r.h - 1) : 0);
      var d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
      if (d === 0) return i;
    }
    return best;
  }

  /**
   * nearestCellOf(cells, w, h, value, x, y, skip) -> cell index, or -1
   * The stitch of palette entry `value` closest to (x, y) for which
   * skip(i) is false — "the next stitch of this colour" near where the
   * stitcher is. Ties go to reading order. One linear pass, so ~1 ms on a
   * 50,000-stitch chart.
   */
  function nearestCellOf(cells, w, h, value, x, y, skip) {
    var best = -1, bestD = Infinity, n = Math.min(cells.length, w * h);
    for (var i = 0; i < n; i++) {
      if (cells[i] !== value) continue;
      if (skip && skip(i)) continue;
      var cx = i % w, cy = (i / w) | 0;
      var d = (cx - x) * (cx - x) + (cy - y) * (cy - y);
      if (d < bestD) { bestD = d; best = i; if (!d) break; }
    }
    return best;
  }

  /**
   * nextStitchNear(cells, w, h, value, x, y, done) -> cell index, or -1
   * Where the tap button's next stitch of palette entry `value` goes
   * (brainstorm 04 #15: count where the stitcher is, not from the top-left).
   * Inside the 10×10 block holding (x, y), the first stitch still to do in
   * reading order; when that block has none left, the block of the nearest
   * stitch still to do, again from its first one in reading order. So taps
   * fill a block the way a stitcher works it and then move to the next
   * block with that colour, never back to row 1.
   */
  function nextStitchNear(cells, w, h, value, x, y, done) {
    function firstInBlock(bx, by) {
      for (var yy = by; yy < by + 10 && yy < h; yy++) {
        for (var xx = bx; xx < bx + 10 && xx < w; xx++) {
          var i = yy * w + xx;
          if (cells[i] === value && !(done && done(i))) return i;
        }
      }
      return -1;
    }
    x = clampInt(x, 0, Math.max(0, w - 1), 0);
    y = clampInt(y, 0, Math.max(0, h - 1), 0);
    var here = firstInBlock(Math.floor(x / 10) * 10, Math.floor(y / 10) * 10);
    if (here >= 0) return here;
    var near = nearestCellOf(cells, w, h, value, x, y, done);
    if (near < 0) return -1;
    return firstInBlock(Math.floor((near % w) / 10) * 10, Math.floor(((near / w) | 0) / 10) * 10);
  }

  /**
   * normalize(raw, project) -> XSData
   * Never throws. Repairs or creates every field in the B2 data model.
   */
  function normalize(raw, project) {
    var d = isObj(raw) ? raw : {};
    var out = { v: 1 };
    /* Wave K (#20): another counted-grid craft on the same engine. Absent
       means cross-stitch, so older saves are unchanged. */
    if (d.kind && d.kind !== 'cross' && KINDS[d.kind]) out.kind = d.kind;

    /* fabric */
    var f = isObj(d.fabric) ? d.fabric : {};
    var count = clampInt(f.count, 1, 40, 14);
    out.fabric = {
      count: count,
      countY: clampInt(f.countY, 1, 40, count),
      over: f.over === 2 || f.over === '2' ? 2 : 1,
      kind: FABRIC_KINDS[f.kind] ? f.kind : 'aida',
      color: str(f.color, 'White'),
      widthIn: f.widthIn === null || f.widthIn === undefined ? null : num(f.widthIn, null),
      heightIn: f.heightIn === null || f.heightIn === undefined ? null : num(f.heightIn, null)
    };

    /* design */
    var de = isObj(d.design) ? d.design : {};
    out.design = {
      w: de.w === null || de.w === undefined ? null : clampInt(de.w, 1, 20000, null),
      h: de.h === null || de.h === undefined ? null : clampInt(de.h, 1, 20000, null),
      title: str(de.title, ''),
      designer: str(de.designer, ''),
      copyright: str(de.copyright, '')
    };

    out.strandsDefault = clampInt(d.strandsDefault, 1, 12, 2);

    /* palette */
    var palette = [];
    if (Array.isArray(d.palette)) {
      for (var i = 0; i < d.palette.length; i++) {
        palette.push(normalizePaletteEntry(d.palette[i], palette.length, out.strandsDefault));
      }
    }
    for (var pi = 0; pi < palette.length; pi++) palette[pi].i = pi;
    out.palette = palette;

    /* chart */
    out.chart = normalizeChart(d.chart, null);
    if (out.chart && (out.design.w === null || out.design.h === null)) {
      out.design.w = out.chart.w;
      out.design.h = out.chart.h;
    }

    /* pages */
    var pages = [];
    if (Array.isArray(d.pages)) {
      for (var pg = 0; pg < d.pages.length; pg++) {
        var q = d.pages[pg];
        if (!isObj(q)) continue;
        pages.push({
          n: clampInt(q.n, 0, 9999, pages.length),
          label: str(q.label, 'Page ' + (clampInt(q.n, 0, 9999, pages.length) + 1)),
          blobKey: str(q.blobKey, ''),
          w: clampInt(q.w, 0, 20000, 0),
          h: clampInt(q.h, 0, 20000, 0),
          isChart: q.isChart === undefined ? true : !!q.isChart,
          /* Wave F (04 #3): the part of the cell chart this page prints, when
             the grid reader placed it. */
          region: normalizeRegion(q.region)
        });
      }
    }
    out.pages = pages;

    /* progress */
    var pr = isObj(d.progress) ? d.progress : {};
    var mode = out.chart ? 'cells' : 'counts';
    if (pr.mode === 'counts') mode = 'counts';
    if (pr.mode === 'cells' && !out.chart) mode = 'counts';
    var nCells = out.chart ? out.chart.w * out.chart.h : 0;
    var done = str(pr.done, '');
    if (mode !== 'cells') done = '';

    /* The three extra layers are one bit per list entry, so a chart that has
       been re-imported at a different size gets its bitmaps re-cut to the new
       length (extra bits dropped, missing ones zero) rather than silently
       marking the wrong segments. They are small lists — hundreds, not
       hundreds of thousands — so refitting them on every load is free. */
    var nBack = out.chart ? out.chart.back.length : 0;
    var nPart = out.chart ? out.chart.part.length : 0;
    var nKnots = out.chart ? out.chart.knots.length : 0;
    var doneBack = mode === 'cells' ? refitBits(pr.doneBack, nBack) : '';
    var donePart = mode === 'cells' ? refitBits(pr.donePart, nPart) : '';
    var doneKnots = mode === 'cells' ? refitBits(pr.doneKnots, nKnots) : '';

    var perColor = [];
    var seen = {};
    if (Array.isArray(pr.perColor)) {
      for (var c2 = 0; c2 < pr.perColor.length; c2++) {
        var pc = pr.perColor[c2];
        if (!isObj(pc)) continue;
        var idx = clampInt(pc.i, 0, 9999, -1);
        if (idx < 0 || idx >= palette.length || seen[idx]) continue;
        seen[idx] = 1;
        perColor.push({ i: idx, done: clampInt(pc.done, 0, 1e9, 0) });
      }
    }
    for (var c3 = 0; c3 < palette.length; c3++) {
      if (!seen[c3]) perColor.push({ i: c3, done: 0 });
    }
    perColor.sort(function (a, b) { return a.i - b.i; });

    var pageDone = [];
    if (Array.isArray(pr.pageDone)) {
      for (var pd = 0; pd < pr.pageDone.length; pd++) {
        var r = pr.pageDone[pd];
        if (!isObj(r)) continue;
        pageDone.push({ page: clampInt(r.page, 0, 9999, 0), done: !!r.done });
      }
    }

    var blocks = {};
    if (isObj(pr.blocks)) {
      var bk = Object.keys(pr.blocks);
      for (var bi = 0; bi < bk.length; bi++) {
        if (/^\d+,\d+$/.test(bk[bi]) && pr.blocks[bk[bi]]) blocks[bk[bi]] = true;
      }
    }

    out.progress = {
      mode: mode,
      done: done,
      doneCount: mode === 'cells' ? countBits(done, nCells) : clampInt(pr.doneCount, 0, 1e9, 0),
      doneBack: doneBack,
      doneBackCount: countBits(doneBack, nBack),
      donePart: donePart,
      donePartCount: countBits(donePart, nPart),
      doneKnots: doneKnots,
      doneKnotsCount: countBits(doneKnots, nKnots),
      perColor: perColor,
      pageDone: pageDone,
      blocks: blocks
    };
    /* Wave K (#1): taps on a colour the chart has no square of, counted
       against the key's printed count (totals().fromKey). Kept only when
       present. */
    if (isObj(pr.keyDone)) {
      var kdOut = {}, kdk = Object.keys(pr.keyDone), anyKd = false;
      for (var kq = 0; kq < kdk.length; kq++) {
        var kix = clampInt(kdk[kq], 0, 9999, -1), kv = clampInt(pr.keyDone[kdk[kq]], 0, 1e9, 0);
        if (kix >= 0 && kix < palette.length && kv > 0) { kdOut[kix] = kv; anyKd = true; }
      }
      if (anyKd) out.progress.keyDone = kdOut;
    }
    if (mode === 'cells') {
      var st = progressStats(out);
      /* doneCount stays the popcount of `done` — the crosses — while
         stats.done is the whole piece including the three extra layers. */
      out.progress.doneCount = st.breakdown.cross.done;
      for (var sc = 0; sc < st.byColor.length && sc < out.progress.perColor.length; sc++) {
        out.progress.perColor[sc].done = st.byColor[sc].done;
      }
    }

    /* current */
    var cu = isObj(d.current) ? d.current : {};
    out.current = {
      paletteIndex: clampInt(cu.paletteIndex, 0, Math.max(0, palette.length - 1), 0),
      page: clampInt(cu.page, 0, 9999, 0),
      cx: clampInt(cu.cx, 0, 20000, 0),
      cy: clampInt(cu.cy, 0, 20000, 0),
      zoom: num(cu.zoom, 1) > 0 ? num(cu.zoom, 1) : 1,
      /* Wave F (04 #2): where the full chart was left, so reopening it lands
         there. null = never moved (open at Fit). */
      view: normalizeView(cu.view, out.chart),
      tool: CHART_TOOLS[cu.tool] ? cu.tool : 'tap',
      layer: CHART_LAYERS[cu.layer] ? cu.layer : 'cross'
    };
    /* Wave J: the Row by row sheet's options (app-xstitch.js normRowOpts).
       Only present when the app has saved some, so older saves normalise
       exactly as before. */
    var rowOpts = normalizeRowOpts(cu.rowOpts, palette.length);
    if (rowOpts) out.current.rowOpts = rowOpts;

    /* parking */
    var parking = [];
    if (Array.isArray(d.parking)) {
      for (var pk = 0; pk < d.parking.length; pk++) {
        var park = d.parking[pk];
        if (!isObj(park)) continue;
        var corner = park.corner;
        var pkOut = {
          key: str(park.key, ''),
          symbol: str(park.symbol, ''),
          corner: (corner === 'tl' || corner === 'tr' || corner === 'bl' || corner === 'br') ? corner : 'tl',
          note: str(park.note, '')
        };
        /* Wave K (#3): where on the chart the thread is parked, and which
           colour. Kept only when present (older saves unchanged). */
        if (out.chart && park.x !== undefined && park.y !== undefined) {
          var pkx = clampInt(park.x, 0, out.chart.w - 1, -1), pky = clampInt(park.y, 0, out.chart.h - 1, -1);
          if (pkx >= 0 && pky >= 0) { pkOut.x = pkx; pkOut.y = pky; }
        }
        if (park.paletteIndex !== undefined && park.paletteIndex !== null) {
          var pkp = clampInt(park.paletteIndex, 0, Math.max(0, palette.length - 1), -1);
          if (pkp >= 0 && pkp < palette.length) pkOut.paletteIndex = pkp;
        }
        parking.push(pkOut);
      }
    }
    out.parking = parking;

    /* Wave K (#21): the stitcher's goals (goalProgress reads them). Kept
       only when present, so older saves normalise as before. */
    if (Array.isArray(d.goals)) {
      var goals = [], GOAL_KINDS = { perDay: 1, page: 1, colour: 1, total: 1 };
      for (var gq = 0; gq < d.goals.length && goals.length < 50; gq++) {
        var go = d.goals[gq];
        if (!isObj(go) || !GOAL_KINDS[go.kind]) continue;
        var gOut = { id: str(go.id, '').slice(0, 40) || ('g' + gq), kind: go.kind,
          createdAt: clampInt(go.createdAt, 0, 1e15, 0) };
        if (go.kind === 'perDay') gOut.n = clampInt(go.n, 1, 1e7, 100);
        if (go.kind === 'page') {
          var gp = clampInt(go.page, 0, 9999, -1);
          if (gp < 0) continue;
          gOut.page = gp;
        }
        if (go.kind === 'colour') {
          var gc = clampInt(go.color, 0, 9999, -1);
          if (gc < 0 || gc >= palette.length) continue;
          gOut.color = gc;
        }
        var gby = clampInt(go.by, 0, 1e15, 0);
        if (gby) gOut.by = gby;
        var glab = str(go.label, '').replace(/\s+/g, ' ').trim().slice(0, 120);
        if (glab) gOut.label = glab;
        if (go.done === true) gOut.done = true;
        goals.push(gOut);
      }
      out.goals = goals;
    }

    /* stash */
    var stash = {};
    if (isObj(d.stash)) {
      var sk = Object.keys(d.stash);
      for (var si = 0; si < sk.length; si++) {
        var v = clampInt(d.stash[sk[si]], 0, 9999, null);
        if (v !== null) stash[sk[si]] = v;
      }
    }
    out.stash = stash;

    out.notesKey = str(d.notesKey, '');
    /* When the "this chart is large" sheet was last shown for this project, so
       it is offered once per import rather than after every tap (risk #4). */
    out.sizeWarnedAt = clampInt(d.sizeWarnedAt, 0, 1e15, 0);

    var so = isObj(d.source) ? d.source : {};
    var warnings = [];
    if (Array.isArray(so.warnings)) {
      for (var wi = 0; wi < so.warnings.length; wi++) {
        var wm = str(so.warnings[wi], '').trim();
        if (wm) warnings.push(wm);
      }
    }
    out.source = {
      kind: SOURCE_KINDS[so.kind] ? so.kind : 'manual',
      fileName: str(so.fileName, ''),
      importedAt: clampInt(so.importedAt, 0, 1e15, 0),
      warnings: warnings
    };
    /* Wave J: what a chart read from a picture records (app-xstitch.js
       "Use this chart"). Each is kept only when it was there. */
    var srcCheck = normalizeSourceCheck(so.check);
    if (srcCheck) out.source.check = srcCheck;
    var spic = str(so.picture, '').trim();
    if (spic && spic.length <= 200) out.source.picture = spic;

    /* project is accepted for symmetry with the shell's normalizeProject; the
       cross-stitch model does not need anything out of it in v1. */
    if (project) { /* no-op */ }

    return out;
  }

  /** summary(project) -> 'Cottage · 8 of 13 colours · 41%' */
  function summary(project) {
    var data;
    try {
      data = isObj(project) && isObj(project.craftData) ? project.craftData : {};
    } catch (e) { data = {}; }
    var palette = Array.isArray(data.palette) ? data.palette : [];
    var design = isObj(data.design) ? data.design : {};
    var parts = [];

    var title = str(design.title, '').trim();
    if (title) parts.push(title);

    var stats;
    try { stats = progressStats(data); } catch (e2) { stats = { done: 0, total: 0, pct: 0, byColor: [] }; }

    if (palette.length) {
      /* A colour is finished when every layer of it is — crosses, backstitch,
         knots and fractionals — and stats.pct counts all four too. */
      var doneColors = 0;
      for (var i = 0; i < stats.byColor.length; i++) {
        if (stats.byColor[i].complete) doneColors++;
      }
      parts.push(doneColors + ' of ' + palette.length + ' colour' + (palette.length === 1 ? '' : 's'));
    } else if (design.w && design.h) {
      parts.push(design.w + ' × ' + design.h + ' stitches');
    }

    /* An image-only PDF import has no key yet; its pages are the progress. */
    var pages = Array.isArray(data.pages) ? data.pages : [];
    if (pages.length) {
      var pageDone = 0;
      var pd = isObj(data.progress) && Array.isArray(data.progress.pageDone) ? data.progress.pageDone : [];
      for (var q = 0; q < pd.length; q++) if (pd[q] && pd[q].done) pageDone++;
      parts.push(pageDone
        ? (pageDone + ' of ' + pages.length + ' page' + (pages.length === 1 ? '' : 's') + ' done')
        : (pages.length + ' chart page' + (pages.length === 1 ? '' : 's')));
    }

    if (stats.total > 0) parts.push(stats.pct + '%');
    if (!parts.length) return 'Cross-stitch project';
    return parts.join(' · ');
  }

  /* Built-in templates (B1). The craft emoji is the thread spool per
     docs/CRAFTS.md; the research doc's ❌ was rejected as ugly on some
     platforms. */
  var TEMPLATES = [
    {
      id: 'xs-blank',
      name: 'Cross-stitch project',
      emoji: '🧵',
      craft: 'crossstitch',
      countMode: 'rows',
      groupSize: 10,
      parts: [{ name: 'Main', makeCount: 1 }],
      checklist: [],
      craftData: { v: 1, fabric: { count: 14, countY: 14, over: 1, kind: 'aida', color: 'White' }, strandsDefault: 2 }
    },
    {
      id: 'xs-sampler',
      name: 'Sampler',
      emoji: '🌸',
      craft: 'crossstitch',
      countMode: 'rows',
      groupSize: 10,
      parts: [{ name: 'Main', makeCount: 1 }],
      checklist: [
        'Cut and zigzag fabric',
        'Grid the fabric',
        'Find the centre',
        'Stitch the border',
        'Backstitch',
        'Wash and press',
        'Frame'
      ],
      craftData: { v: 1, fabric: { count: 14, countY: 14, over: 1, kind: 'aida', color: 'White' }, strandsDefault: 2 }
    },
    {
      id: 'xs-kit',
      name: 'Kit',
      emoji: '🎁',
      craft: 'crossstitch',
      countMode: 'rows',
      groupSize: 10,
      parts: [{ name: 'Main', makeCount: 1 }],
      checklist: [
        'Sort the floss',
        'Check the key against the kit',
        'Grid the fabric'
      ],
      craftData: { v: 1, fabric: { count: 14, countY: 14, over: 1, kind: 'aida', color: 'White' }, strandsDefault: 2 }
    }
  ];

  /* ================================================================== *
   * 8. OXS (B3.2 / B7)
   * ================================================================== */

  var OXS_BRAND_RE = /^(DMC|Anchor|Madeira|Cosmo|Olympus|Sullivans)$/i;

  /* ---- ornament object types --------------------------------------- *
   * The OXS note block only says "there is a wide variety of ways of treating
   * part stitches, knots, beads and so on", so writers spell the ornament
   * type however they like. Ursa Software's own reference chart
   * (tmp-pdf/xs-ursa-piggies.oxs) writes `bead3mm`, and a size suffix is the
   * commonest variation there is — matching on a prefix keeps `bead2mm`,
   * `bead_11_0` and `frenchknot` out of the "unknown objecttype" bucket,
   * where they would have been dropped silently.
   * ------------------------------------------------------------------ */
  var ORNAMENT_KNOT_RE = /^(?:french[_\s-]*)?knot/i;
  var ORNAMENT_BEAD_RE = /^(?:bead|button|sequin|treasure|charm|ornament)/i;

  function attr(el, name) {
    var v = el.getAttribute(name);
    return v === null ? '' : v;
  }

  function kids(parent, tag) {
    return parent ? parent.getElementsByTagName(tag) : [];
  }

  /* ---- big-chart fast path -----------------------------------------
   * DOMParser costs ~400 ms on the 12 MB of XML a 350,000-stitch chart
   * produces, and almost all of that is the <fullstitches> block. When that
   * block is large AND provably trivial (nothing but <stitch> elements, no
   * comments, no CDATA and no entities), we lift it out, hand the small
   * remainder to DOMParser as usual and scan the block with a regex instead.
   * Anything unusual in there falls back to the plain DOM path.
   * ------------------------------------------------------------------ */

  var FAST_MIN_BYTES = 400000;
  /* The shape every writer we have seen emits, tried first because one regex
     is four times faster than a generic attribute walk. */
  var STITCH_ORDERED_RE = /<stitch x="([^"]*)" y="([^"]*)" palindex="([^"]*)"([^>]*)>/g;
  var STITCH_RE = /<stitch\b([^>]*)>/g;
  var ATTR_RE = /([a-zA-Z_][\w:.-]*)\s*=\s*"([^"]*)"/g;

  function splitFullStitches(xmlText) {
    var open = xmlText.indexOf('<fullstitches');
    if (open < 0) return null;
    var openEnd = xmlText.indexOf('>', open);
    if (openEnd < 0 || xmlText.charAt(openEnd - 1) === '/') return null;
    var close = xmlText.indexOf('</fullstitches>', openEnd);
    if (close < 0) return null;
    var block = xmlText.slice(openEnd + 1, close);
    if (block.length < FAST_MIN_BYTES) return null;
    if (block.indexOf('<!--') >= 0 || block.indexOf('<![') >= 0 || block.indexOf('&') >= 0) return null;
    if (/<(?!stitch[\s/>])/.test(block)) return null;
    return { head: xmlText.slice(0, openEnd + 1) + xmlText.slice(close), block: block };
  }

  function countStitchTags(block) {
    var n = 0, at = 0;
    while ((at = block.indexOf('<stitch', at)) >= 0) { n++; at += 7; }
    return n;
  }

  /**
   * parseOXS(xmlText) -> { ok, data, warnings }
   *
   * data = { design, fabric, palette, chart, strandsDefault, notesKey,
   *          progress: { mode:'cells', done, doneCount } }
   * The extra `progress` carries the `marked="true"` stitches through as an
   * initial done bitmap (B4.1).
   */
  function parseOXS(xmlText) {
    var warnings = [];
    var fail = function (msg) {
      pushOnce(warnings, msg);
      return { ok: false, data: null, warnings: warnings };
    };

    if (typeof xmlText !== 'string' || !xmlText.replace(/\s+/g, '')) return fail('empty file');
    if (typeof DOMParser === 'undefined') return fail('no XML parser available');

    var fast = null;
    try { fast = splitFullStitches(xmlText); } catch (eSplit) { fast = null; }

    var doc;
    try { doc = new DOMParser().parseFromString(fast ? fast.head : xmlText, 'application/xml'); }
    catch (e) { return fail('could not parse XML'); }
    if (!doc || !doc.documentElement) return fail('could not parse XML');
    if (doc.getElementsByTagName('parsererror').length ||
        doc.documentElement.nodeName === 'parsererror') return fail('could not parse XML');

    var root = doc.documentElement;
    if (String(root.nodeName).toLowerCase() !== 'chart') return fail('not an OXS chart');

    /* ---- properties ---- */
    var props = kids(root, 'properties')[0] || null;
    var design = { w: null, h: null, title: '', designer: '', copyright: '' };
    var fabric = { count: 14, countY: 14, over: 1, kind: 'aida', color: 'White', widthIn: null, heightIn: null };
    var notesKey = '';
    if (props) {
      design.w = clampInt(attr(props, 'chartwidth'), 1, 20000, null);
      design.h = clampInt(attr(props, 'chartheight'), 1, 20000, null);
      design.title = attr(props, 'charttitle').trim();
      design.designer = attr(props, 'author').trim();
      design.copyright = attr(props, 'copyright').trim();
      notesKey = attr(props, 'instructions').trim();
      fabric.count = clampInt(attr(props, 'stitchesperinch'), 1, 40, 14);
      fabric.countY = clampInt(attr(props, 'stitchesperinch_y'), 1, 40, fabric.count);
    } else {
      pushOnce(warnings, 'no <properties> element');
    }

    /* ---- palette ---- */
    var palEl = kids(root, 'palette')[0] || null;
    var items = palEl ? kids(palEl, 'palette_item') : [];
    var palette = [];
    var oxsToOur = {};
    var strandCounts = {};
    var i;

    for (i = 0; i < items.length; i++) {
      var it = items[i];
      var oxsIndex = clampInt(attr(it, 'index'), 0, 9999, i);
      var number = attr(it, 'number').trim();
      var pname = attr(it, 'name').trim();
      var color = attr(it, 'color').trim();

      var isCloth = number.toLowerCase() === 'cloth' ||
        (oxsIndex === 0 && (number.toLowerCase() === 'cloth' || pname.toLowerCase() === 'cloth'));
      if (isCloth) {
        pushOnce(warnings, 'cloth palette entry skipped');
        var clothHex = normHex(color, null);
        if (clothHex && clothHex !== 'ffffff') fabric.color = '#' + clothHex.toUpperCase();
        continue;
      }

      var brand = '', code = number;
      var sp = number.indexOf(' ');
      if (sp > 0) {
        var first = number.slice(0, sp);
        if (OXS_BRAND_RE.test(first)) {
          brand = canonBrand(first);
          code = number.slice(sp + 1).trim();
        }
      }

      var hex = normHex(color, null);
      if (!hex) {
        hex = hexFor(brand || 'DMC', code) || '808080';
        pushOnce(warnings, 'bad colour value in the palette');
      }

      var blend = attr(it, 'blendcolor').trim().toLowerCase();
      var isBlend = !!blend && blend !== 'nil';

      var strandsAttr = clampInt(attr(it, 'strands'), 1, 12, null);
      if (strandsAttr !== null) strandCounts[strandsAttr] = (strandCounts[strandsAttr] || 0) + 1;

      var our = palette.length;
      oxsToOur[oxsIndex] = our;
      palette.push({
        i: our,
        symbol: '',
        brand: brand,
        code: code,
        name: pname,
        hex: hex,
        strands: strandsAttr === null ? 2 : strandsAttr,
        bsStrands: clampInt(attr(it, 'bsstrands'), 1, 12, 1),
        kind: isBlend ? 'blend' : 'cross',
        blendWith: null,
        stitchCount: 0,
        skeins: 0,
        have: false
      });
    }
    if (!palette.length) pushOnce(warnings, 'no floss colours in the palette');

    var strandsDefault = 2, bestN = 0;
    for (var sKey in strandCounts) {
      if (strandCounts[sKey] > bestN) { bestN = strandCounts[sKey]; strandsDefault = parseInt(sKey, 10); }
    }
    for (i = 0; i < palette.length; i++) {
      if (!palette[i].strands) palette[i].strands = strandsDefault;
    }

    function mapIndex(v) {
      var n = clampInt(v, 0, 9999, -1);
      if (n < 0) return -1;
      return oxsToOur[n] === undefined ? -1 : oxsToOur[n];
    }

    /* ---- stitches ---- */
    var fullEls = fast ? null : kids(kids(root, 'fullstitches')[0], 'stitch');
    var partEls = kids(kids(root, 'partstitches')[0], 'partstitch');
    var backEls = kids(kids(root, 'backstitches')[0], 'backstitch');
    var ornEls = kids(kids(root, 'ornaments_inc_knots_and_beads')[0], 'object');

    var part = [], back = [], knots = [];
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    function seeCell(x, y) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }

    /* Full stitches are the hot path: a 500x700 chart has 350,000 of them, so
       they go into flat typed arrays rather than 350,000 little objects. */
    var nFull = fast ? countStitchTags(fast.block) : fullEls.length;
    var fullX = new Int32Array(nFull);
    var fullY = new Int32Array(nFull);
    var fullI = new Int32Array(nFull);
    var fullM = new Uint8Array(nFull);
    var nStitch = 0;

    function takeStitch(sx, sy, sp, sm) {
      if (sx === null || sy === null) return;
      var fx = Math.round(+sx), fy = Math.round(+sy);
      if (fx !== fx || fy !== fy) return;                      // NaN check
      var fi = sp === null ? undefined : oxsToOur[+sp];
      if (fi === undefined) { pushOnce(warnings, 'stitch with an unknown palette index'); return; }
      if (nStitch >= nFull) return;
      fullX[nStitch] = fx;
      fullY[nStitch] = fy;
      fullI[nStitch] = fi;
      if (sm === 'true') fullM[nStitch] = 1;
      nStitch++;
      if (fx < minX) minX = fx;
      if (fy < minY) minY = fy;
      if (fx > maxX) maxX = fx;
      if (fy > maxY) maxY = fy;
    }

    function scanOrdered(block) {
      var m, seen = 0;
      STITCH_ORDERED_RE.lastIndex = 0;
      while ((m = STITCH_ORDERED_RE.exec(block)) !== null) {
        seen++;
        takeStitch(m[1], m[2], m[3], m[4].indexOf('marked="true"') >= 0 ? 'true' : null);
      }
      return seen;
    }

    function scanGeneric(block) {
      var sm, a;
      STITCH_RE.lastIndex = 0;
      while ((sm = STITCH_RE.exec(block)) !== null) {
        var attrs = sm[1];
        var ax = null, ay = null, ap = null, am = null;
        ATTR_RE.lastIndex = 0;
        while ((a = ATTR_RE.exec(attrs)) !== null) {
          var an = a[1];
          if (an === 'x') ax = a[2];
          else if (an === 'y') ay = a[2];
          else if (an === 'palindex') ap = a[2];
          else if (an === 'marked') am = a[2];
        }
        takeStitch(ax, ay, ap, am);
      }
    }

    if (fast) {
      /* Fall back to the attribute walk if the ordered form did not cover
         every <stitch> tag in the block. */
      if (scanOrdered(fast.block) !== nFull) {
        nStitch = 0;
        minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
        scanGeneric(fast.block);
      }
    } else {
      for (i = 0; i < nFull; i++) {
        var fe = fullEls[i];
        takeStitch(fe.getAttribute('x'), fe.getAttribute('y'),
          fe.getAttribute('palindex'), fe.getAttribute('marked'));
      }
    }

    for (i = 0; i < partEls.length; i++) {
      var pe = partEls[i];
      var px = num(attr(pe, 'x'), NaN), py = num(attr(pe, 'y'), NaN);
      if (!isFinite(px) || !isFinite(py)) continue;
      part.push({
        x: px, y: py,
        a: mapIndex(attr(pe, 'palindex1')),
        b: mapIndex(attr(pe, 'palindex2')),
        d: clampInt(attr(pe, 'direction'), 1, 4, 1)
      });
      seeCell(px, py);
    }

    for (i = 0; i < backEls.length; i++) {
      var be = backEls[i];
      var ot = attr(be, 'objecttype').toLowerCase();
      if (ot && ot !== 'backstitch') pushOnce(warnings, 'drew "' + ot + '" as a plain line');
      back.push({
        x1: num(attr(be, 'x1'), 0), y1: num(attr(be, 'y1'), 0),
        x2: num(attr(be, 'x2'), 0), y2: num(attr(be, 'y2'), 0),
        i: mapIndex(attr(be, 'palindex'))
      });
    }

    for (i = 0; i < ornEls.length; i++) {
      var oe = ornEls[i];
      var type = attr(oe, 'objecttype').toLowerCase();
      var ox = num(attr(oe, 'x1'), num(attr(oe, 'x'), NaN));
      var oy = num(attr(oe, 'y1'), num(attr(oe, 'y'), NaN));
      if (!isFinite(ox) || !isFinite(oy)) continue;
      var oi = mapIndex(attr(oe, 'palindex'));
      if (ORNAMENT_KNOT_RE.test(type)) {
        knots.push({ x: ox, y: oy, i: oi, t: 'knot' });
      } else if (ORNAMENT_BEAD_RE.test(type)) {
        knots.push({ x: ox, y: oy, i: oi, t: 'bead' });
      } else if (type === 'tent' || type === 'quarter' ||
                 type === 'verticalhalf' || type === 'horizontalhalf') {
        part.push({ x: ox, y: oy, a: oi, b: -1, d: clampInt(attr(oe, 'direction'), 1, 4, 1) });
        seeCell(ox, oy);
      } else {
        pushOnce(warnings, 'unknown objecttype "' + type + '"');
      }
    }

    /* ---- coordinate origin ---- */
    var w = design.w, h = design.h;
    if (!w || !h) {
      w = isFinite(maxX) ? Math.round(maxX) + 1 : 1;
      h = isFinite(maxY) ? Math.round(maxY) + 1 : 1;
      design.w = w; design.h = h;
      pushOnce(warnings, 'chart size missing, inferred from the stitches');
    }
    var shift = 0;
    if (isFinite(minX) && isFinite(minY) && minX >= 1 && minY >= 1 && maxX <= w && maxY <= h) shift = 1;

    /* ---- build the cell grid ---- */
    var n = w * h;
    var cells = new Int16Array(n);
    for (i = 0; i < n; i++) cells[i] = -1;
    var doneBits = new Uint8Array(n);
    var counts = [];
    for (i = 0; i < palette.length; i++) counts.push(0);

    var anyDone = false;
    var doneCount = 0;
    for (i = 0; i < nStitch; i++) {
      var cx = fullX[i] - shift, cy = fullY[i] - shift;
      if (cx < 0 || cy < 0 || cx >= w || cy >= h) { pushOnce(warnings, 'some stitches fall outside the chart'); continue; }
      var at = cy * w + cx;
      var si = fullI[i];
      cells[at] = si;
      counts[si] = (counts[si] || 0) + 1;
      if (fullM[i]) { doneBits[at] = 1; anyDone = true; }
    }
    if (anyDone) { for (i = 0; i < n; i++) if (doneBits[i]) doneCount++; }

    for (i = 0; i < part.length; i++) {
      part[i].x = Math.round(part[i].x) - shift;
      part[i].y = Math.round(part[i].y) - shift;
      if (part[i].a >= 0) counts[part[i].a] = (counts[part[i].a] || 0) + 0.5;
      if (part[i].b >= 0) counts[part[i].b] = (counts[part[i].b] || 0) + 0.5;
    }
    for (i = 0; i < back.length; i++) {
      back[i].x1 -= shift; back[i].x2 -= shift;
      back[i].y1 -= shift; back[i].y2 -= shift;
    }
    for (i = 0; i < knots.length; i++) {
      knots[i].x -= shift;
      knots[i].y -= shift;
    }

    for (i = 0; i < palette.length; i++) palette[i].stitchCount = Math.round(counts[i] || 0);
    assignSymbols(palette);

    var chart = {
      w: w, h: h,
      cells: packCells(cells, w, h),
      part: part, back: back, knots: knots
    };

    var doneB64 = anyDone ? packBits(doneBits, n) : '';

    return {
      ok: true,
      data: {
        design: design,
        fabric: fabric,
        palette: palette,
        chart: chart,
        strandsDefault: strandsDefault,
        notesKey: notesKey,
        progress: { mode: 'cells', done: doneB64, doneCount: doneCount }
      },
      warnings: warnings
    };
  }

  /* ---- toOXS ------------------------------------------------------- */

  function xmlEsc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function numStr(n) {
    var v = Math.round(num(n, 0) * 100) / 100;
    return String(v);
  }

  /**
   * toOXS(data) -> string
   * `data` is an XSData (or anything normalize() accepts). Coordinates are
   * written 1-based, our palette index 0 becomes OXS index 1, and a synthetic
   * `cloth` entry takes index 0 — exactly what parseOXS reads back.
   */
  function toOXS(data) {
    var d = normalize(data, null);
    var chart = d.chart;
    var w = chart ? chart.w : (d.design.w || 1);
    var h = chart ? chart.h : (d.design.h || 1);
    var pal = d.palette;
    var i;

    var lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<chart>');
    lines.push('<format comments01="Designed to allow interchange of basic pattern data between any cross stitch style software" comments02="" />');
    lines.push('<properties software="Thready or Not" software_version="1"' +
      ' chartheight="' + h + '" chartwidth="' + w + '"' +
      ' charttitle="' + xmlEsc(d.design.title) + '"' +
      ' author="' + xmlEsc(d.design.designer) + '"' +
      ' copyright="' + xmlEsc(d.design.copyright) + '"' +
      ' instructions="' + xmlEsc(d.notesKey) + '"' +
      ' stitchesperinch="' + d.fabric.count + '"' +
      ' stitchesperinch_y="' + d.fabric.countY + '"' +
      ' palettecount="' + (pal.length + 1) + '" />');

    var clothHex = normHex(d.fabric.color, 'FFFFFF');
    clothHex = (clothHex || 'ffffff').toUpperCase();
    lines.push('<palette>');
    lines.push('<palette_item index="0" number="cloth" name="cloth" color="' + clothHex +
      '" printcolor="' + clothHex + '" blendcolor="nil" comments="" strands="' +
      d.strandsDefault + '" symbol="0" dashpattern="" misc1="" />');
    for (i = 0; i < pal.length; i++) {
      var p = pal[i];
      var number = (p.brand ? p.brand + ' ' : '') + p.code;
      var hex = (p.hex || '808080').toUpperCase();
      lines.push('<palette_item index="' + (i + 1) + '" number="' + xmlEsc(number) +
        '" name="' + xmlEsc(p.name) + '" color="' + hex + '" printcolor="' + hex +
        '" blendcolor="nil" comments="" strands="' + p.strands +
        '" bsstrands="' + p.bsStrands + '" symbol="' + (i + 1) + '" dashpattern="" misc1="" />');
    }
    lines.push('</palette>');

    /* full stitches */
    lines.push('<fullstitches>');
    if (chart) {
      var cells = unpackCells(chart.cells);
      var bits = d.progress.mode === 'cells' && d.progress.done
        ? unpackBits(d.progress.done, w * h) : null;
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var at = y * w + x;
          var v = at < cells.length ? cells[at] : -1;
          if (v < 0 || v >= pal.length) continue;
          lines.push('<stitch x="' + (x + 1) + '" y="' + (y + 1) + '" palindex="' + (v + 1) + '"' +
            (bits && bits[at] ? ' marked="true"' : '') + '/>');
        }
      }
    }
    lines.push('</fullstitches>');

    /* OXS carries a `marked` flag on <stitch> ONLY. <partstitch>, <backstitch>
       and the ornament objects have no equivalent in the format, so our
       progress.donePart / doneBack / doneKnots bitmaps are deliberately NOT
       written here: they stay in craftData (and therefore in the app's own
       JSON backup) and an OXS round-trip brings those layers back unmarked.
       Writing an invented attribute would only confuse other stitching apps.*/
    lines.push('<partstitches>');
    if (chart) {
      for (i = 0; i < chart.part.length; i++) {
        var pt = chart.part[i];
        lines.push('<partstitch x="' + (pt.x + 1) + '" y="' + (pt.y + 1) +
          '" palindex1="' + (pt.a >= 0 ? pt.a + 1 : 0) + '" palindex2="' + (pt.b >= 0 ? pt.b + 1 : 0) +
          '" direction="' + pt.d + '"/>');
      }
    }
    lines.push('</partstitches>');

    lines.push('<backstitches>');
    if (chart) {
      for (i = 0; i < chart.back.length; i++) {
        var bs = chart.back[i];
        lines.push('<backstitch x1="' + numStr(bs.x1 + 1) + '" x2="' + numStr(bs.x2 + 1) +
          '" y1="' + numStr(bs.y1 + 1) + '" y2="' + numStr(bs.y2 + 1) +
          '" palindex="' + (bs.i >= 0 ? bs.i + 1 : 0) + '" objecttype="backstitch" sequence="' + i + '"/>');
      }
    }
    lines.push('</backstitches>');

    lines.push('<ornaments_inc_knots_and_beads>');
    if (chart) {
      for (i = 0; i < chart.knots.length; i++) {
        var kn = chart.knots[i];
        lines.push('<object x1="' + numStr(kn.x + 1) + '" y1="' + numStr(kn.y + 1) +
          '" palindex="' + (kn.i >= 0 ? kn.i + 1 : 0) + '" objecttype="' +
          (kn.t === 'bead' ? 'bead' : 'knot') + '"/>');
      }
    }
    lines.push('</ornaments_inc_knots_and_beads>');

    lines.push('<commentboxes></commentboxes>');
    lines.push('</chart>');
    return lines.join('\n');
  }

  /* ================================================================== *
   * 9. PDF key parser (B3.3)
   * ================================================================== */

  var NAMED_CODE_RE = /^(B5200|Blanc\s*Neige|Blanc|Ecru|White|Snow\s*White)$/i;
  var CODE_TOKEN_RE = /^(?:B5200|Blanc|Ecru|White|E\d{3,4}|\d{1,5})$/i;

  var UNIT_MAP = {
    str: 'strands', strs: 'strands', strand: 'strands', strands: 'strands', ply: 'strands',
    st: 'stitches', sts: 'stitches', stitch: 'stitches', stitches: 'stitches', x: 'stitches',
    sk: 'skeins', skein: 'skeins', skeins: 'skeins'
  };

  function normUnitWord(w) {
    return UNIT_MAP[String(w).toLowerCase().replace(/[.,;:]+$/, '')] || null;
  }

  function isWordToken(t) { return /^[A-Za-z][A-Za-z'’\-]{2,}$/.test(t); }

  function symbolish(t) {
    if (!t) return false;
    if (t.length <= 2) return !/^\d{1,5}$/.test(t);
    return t.length <= 4 && !/[A-Za-z0-9]/.test(t);
  }

  function hasUnreadableGlyph(t) {
    if (!t) return false;
    for (var i = 0; i < t.length; i++) {
      var c = t.charCodeAt(i);
      if (c === 0xFFFD) return true;                 // replacement character
      if (c >= 0xE000 && c <= 0xF8FF) return true;   // private use area
      if (c === 0x0000) return true;
    }
    return false;
  }

  /**
   * A page footer glued onto the row beneath it, which is what a generator
   * that prints "38 / 38" in the margin produces when the two run together:
   *   '38 / 383756 (905 ct)'  ->  '3756 (905 ct)'
   * Only fires when the second number starts with the first one and leaves a
   * plausible floss code behind, so a real '10 / 38' is left alone.
   */
  function stripFooterGlue(s) {
    /* The same footer can land on the other side of the code when the
       extractor sorts by x: '340' under '62 / 62' comes out as
       '34062 / 62 (1273 ct)'. The number after the slash is the page count
       (the key is on the last page, so it is also the page number), and
       what is left in front of it has to be a floss we know. */
    var t = /^\s*(\d{4,8})\s*\/\s*(\d{1,3})(?=\s|$)/.exec(s);
    if (t && t[1].length > t[2].length + 2 &&
        t[1].slice(-t[2].length) === t[2]) {
      var code = t[1].slice(0, t[1].length - t[2].length);
      if (/^\d{3,5}$/.test(code) && keyHexFor('DMC', code)) return code + s.slice(t[0].length);
    }
    var m = /^\s*(\d{1,4})\s*\/\s*(\d{2,8})\b/.exec(s);
    if (!m) return s;
    var head = m[1], rest = m[2];
    if (rest.indexOf(head) !== 0) return s;
    var tail = rest.slice(head.length);
    if (!/^\d{3,5}$/.test(tail)) return s;
    return tail + s.slice(m[0].length);
  }

  /**
   * '(56985 ct)', '(905 ct)', '(1,234)' are stitch counts in KG-Chart and
   * friends. Rewritten to 'N sts' so the ordinary tail parser sees them.
   * A bare '(2)' is left alone: that is far more likely to be strands.
   */
  function unwrapCounts(s) {
    return s.replace(/\(\s*(\d[\d,]*)\s*(ct|cts|sts?|stitches)?\s*\)/ig, function (all, n, unit) {
      var v = parseInt(String(n).replace(/,/g, ''), 10);
      if (!isFinite(v)) return all;
      if (!unit && v < 7) return all;
      return ' ' + v + ' sts ';
    });
  }

  /** Normalise a raw line for tokenising: leader dots, pipes, digit groups. */
  function cleanKeyLine(line) {
    var s = String(line == null ? '' : line);
    s = s.replace(/ | | | /g, ' ');
    s = stripChartSoup(s);
    s = stripFooterGlue(s);
    s = unwrapCounts(s);
    // Some generators lose a hyphen in a colour name to the font: 'Red?Copper'.
    s = s.replace(/([A-Za-z])\s*\?\s*([A-Za-z])/g, '$1-$2');
    // leader dots / underscores: runs of 3 or more collapse to one separator
    s = s.replace(/(?:[.·_․…]\s*){3,}/g, ' ');
    // table pipes become plain separators when the line really is a table row
    if ((s.match(/\|/g) || []).length >= 2) s = s.replace(/\|/g, ' ');
    // thousands separators inside digit groups
    s = s.replace(/(\d),(?=\d{3}\b)/g, '$1');
    s = s.replace(/[–—]/g, '-');
    // blends: '310/3799' and '310+3799' get spaced so they tokenise
    s = s.replace(/\b(\d{3,5}|B5200|Blanc|Ecru|White)\s*([+/&])\s*(\d{3,5}|B5200|Blanc|Ecru|White)\b/ig, '$1 $2 $3');
    return s.replace(/\s+/g, ' ').trim();
  }

  function tokenizeKeyLine(s) {
    var toks = s.split(' ');
    var out = [];
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      // strip wrapping brackets and trailing punctuation that is never data
      t = t.replace(/^[(\[{]+/, '').replace(/[)\]}]+$/, '');
      t = t.replace(/^[-:;,]+/, '').replace(/[:;,]+$/, '');
      if (!t) continue;
      if (t === '-' || t === '–' || t === '—') continue;
      out.push(t);
    }
    return out;
  }

  /* Split a glued number+unit token such as '1234sts' or '2str'. */
  function splitGlued(t) {
    var m = /^(\d+)([A-Za-z]+)$/.exec(t);
    if (!m) return null;
    var u = normUnitWord(m[2]);
    return u ? { v: parseInt(m[1], 10), unit: u } : null;
  }

  /**
   * Fit the unlabelled trailing numbers into { strands, stitchCount, skeins }.
   * Leading numbers that cannot be explained fall back into the colour name,
   * which is how 'Delft Blue 3325 2 412' keeps its 3325.
   */
  function fitNums(nums, have) {
    var extra = [];
    var s = have.strands, c = have.stitchCount, k = have.skeins;

    while (nums.length) {
      var open = [];
      if (s === null) open.push('strands');
      if (c === null) open.push('stitchCount');
      if (k === null) open.push('skeins');
      var n = nums.length;

      if (n > open.length) { extra.push(nums.shift()); continue; }

      var has = function (name) { return open.indexOf(name) >= 0; };
      var ok = false;

      if (n === 1) {
        var v = nums[0];
        if (has('strands') && v <= 6) { s = v; ok = true; }
        else if (has('stitchCount')) { c = v; ok = true; }
        else if (has('skeins') && v <= 30) { k = v; ok = true; }
      } else if (n === 2) {
        if (has('strands') && has('stitchCount') && nums[0] <= 6) { s = nums[0]; c = nums[1]; ok = true; }
        else if (has('stitchCount') && has('skeins') && nums[1] <= 30) { c = nums[0]; k = nums[1]; ok = true; }
        else if (has('strands') && has('skeins') && nums[0] <= 6 && nums[1] <= 30) { s = nums[0]; k = nums[1]; ok = true; }
      } else if (n === 3) {
        if (has('strands') && has('stitchCount') && has('skeins') && nums[0] <= 6 && nums[2] <= 30) {
          s = nums[0]; c = nums[1]; k = nums[2]; ok = true;
        }
      }

      if (ok) { nums.length = 0; break; }
      extra.push(nums.shift());
    }
    return { extra: extra, strands: s, stitchCount: c, skeins: k };
  }

  /* ---- grid furniture and key blocks -------------------------------- *
   * Chart pages are full of lines that look numeric enough to fool a naive
   * key parser: the column ruler down the top and bottom of every page
   * ('107 110 120 130 140 150 159') and the row labels down both margins
   * ('155 155'). Neither ever carries colour information, so they are
   * rejected outright; any other all-numeric line is only accepted inside a
   * block that a key header opened.
   * ------------------------------------------------------------------- */

  var INT_TOKEN_RE = /^\d{1,6}$/;

  function allIntegers(toks) {
    if (toks.length < 2) return false;
    for (var i = 0; i < toks.length; i++) if (!INT_TOKEN_RE.test(toks[i])) return false;
    return true;
  }

  /** A margin ruler (3+ ascending integers) or a row label ('155 155'). */
  function looksLikeGridLine(toks) {
    if (!allIntegers(toks)) return false;
    if (toks.length === 2) return toks[0] === toks[1];
    for (var k = 1; k < toks.length; k++) {
      if (parseInt(toks[k], 10) <= parseInt(toks[k - 1], 10)) return false;
    }
    return true;
  }

  /** Lines that open a run of key rows. */
  var KEY_BLOCK_HEADER_RE = new RegExp(
    '^\\s*(?:' +
    'colou?r\\s*table|colou?r\\s*key|colou?rs?\\s*used|' +
    'dmc\\s*#?\\s*(?:and|&)\\s*name|' +
    'floss(?:\\s*(?:list|key|chart))?|legend|key\\b|' +
    'symbol(?:\\s*(?:key|list|chart|table))?|' +
    'thread\\s*(?:list|key)|palette|dmc\\s*$' +
    ')', 'i');

  /* Magazine charts title the key after the design ("Caterpillar cards key",
     "Spring wreath colour key"), so a short line that *ends* in "key" opens
     a block too. Kept short so a sentence about a key does not qualify. */
  var KEY_BLOCK_TAIL_RE = /^[A-Za-z][A-Za-z0-9'’\- ]{2,38}\s(?:colou?r\s+)?key\s*:?\s*$/i;

  /** Lines that close one: the cover-block metadata around a key. */
  var KEY_BLOCK_BREAK_RE =
    /^\s*(?:stitch(?:es)?\s*count|finished\s*size|fabric\b|cloth['’ʼ]?s?\b|design\s*(?:area|size)|#\s*of\s*colou?rs)/i;

  var DECLARED_COLORS_RES = [
    /#\s*of\s*colou?rs?\s*:?\s*(\d{1,4})/i,
    /\bcolou?rs?\s*:\s*(\d{1,4})\b/i,
    /\b(\d{1,4})\s*colou?rs?\s+(?:used|in\s+this)/i
  ];

  /* Apostrophes come out of PDFs as ', ’ or ʼ depending on the font. */
  var CLOTH_COLOR_RES = [
    /\bcloth['’ʼ]?s?\s*colou?r\s*:\s*(.+)$/i,
    /\bfabric\s*colou?r\s*:\s*(.+)$/i,
    /\btoile\s*:\s*colou?r\s*:\s*(.+)$/i
  ];

  /* ---- DMC-library style legends ------------------------------------ *
   * The DMC free patterns print a two-column legend whose symbol glyphs do
   * not survive extraction, leaving rows like 'x 1 741 x 1' (the skeins of
   * one column, then the next colour's number and its skeins) or a plain
   * '946 x 1'. Some sheets drop the skeins entirely and print code pairs,
   * '3808 3831', relying on a '* 1 skein in each colour' line instead.
   * ------------------------------------------------------------------- */

  var SKEIN_EACH_RE = /\*?\s*(\d{1,2})\s*skeins?\s+(?:in|of|per)\s+(?:each\s+)?colou?rs?/i;
  var STRAND_RE = /(\d)\s*(?:strands?|brins?|hebras?|fils?)\b/i;
  var PTS_PER_CM_RE = /(\d+(?:[.,]\d+)?)\s*p\s?ts?\s*\/\s*cm/i;
  var EMBROIDERY_STITCH_RE = /(?:straight|stem|satin|buttonhole|chain|blanket|lazy\s*daisy)\s*stitch/i;

  /** A token that could be a floss number in its own right. */
  function isCodeToken(t) {
    return /^\d{3,5}$/.test(t) || /^E\d{3,4}$/i.test(t) || NAMED_CODE_RE.test(t);
  }

  /**
   * A legend row made only of floss numbers and 'x N' skein marks.
   * Returns [{ code, skeins }] — one per number on the line — or null when
   * the line is not that shape. Two-digit numbers are never codes here, so a
   * stray '89 x 74' cannot masquerade as one.
   */
  function codeListRow(rawLine, allowBare) {
    var toks = String(rawLine == null ? '' : rawLine)
      .replace(/\bx(\d{1,3})\b/ig, 'x $1')
      .trim().split(/\s+/);
    if (toks.length < 1 || toks[0] === '') return null;
    if (looksLikeGridLine(toks)) return null;

    var codes = [], marks = [], lead = [], i;
    for (i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (/^x$/i.test(t)) {
        var next = toks[i + 1];
        if (next && /^\d{1,3}$/.test(next)) {
          var mv = parseInt(next, 10);
          /* A mark in front of the first code belongs to the column to the
             LEFT of this one, whose codes the extractor handed over as a
             block of their own. Keep it aside rather than throwing it. */
          if (!codes.length) lead.push(mv); else marks.push(mv);
          i++;
          continue;
        }
        return null;
      }
      if (isCodeToken(t)) { codes.push(t); continue; }
      if (/^\d{1,2}$/.test(t)) continue;          // a stray column number
      return null;                                 // a word: not this shape
    }
    if (!codes.length) return [];

    if (!marks.length && !lead.length) {
      // No 'x N' anywhere: only trust a run of numbers when the sheet has
      // told us how many skeins every colour takes, and every number is a
      // floss we actually know.
      if (!allowBare || codes.length < 2) return null;
      /* Light Effects E-codes (E677) are real DMC threads without a swatch here. */
      for (i = 0; i < codes.length; i++) {
        if (!keyHexFor('DMC', codes[i]) && !/^E\d{3,4}$/i.test(codes[i])) return null;
      }
    }

    var skeins = marks.length ? marks[marks.length - 1] : null;
    var out = [];
    for (i = 0; i < codes.length; i++) out.push({ code: codes[i], skeins: skeins });
    /* One mark ahead of the codes: the left-hand column's skein for this
       row. parseKey collects them into a column of their own. */
    out.lead = lead.length === 1 ? lead[0] : null;
    return out;
  }

  /* ---- cross-brand column headers ----------------------------------- *
   * Magazine charts (The World of Cross Stitching) and the Tiny Modernist
   * freebies print one column per brand and one row per colour:
   *
   *   DMC Anchor Madeira            X BS DMC Cosmo         X BS DMC Name:
   *   Z B5200 1 2401 white          725 701                453 Shell Grey LT
   *
   * Without the header the Anchor and Madeira numbers land in the colour
   * name ("1 2401 white") or, worse, in the stitch count. The header line
   * tells us how many code columns to skip after the first one, and it also
   * vouches for the rows beneath it the way "Colour key" does — which is
   * what lets a one-character symbol like `2` or `7` be read as a symbol
   * instead of being rejected as an impossible floss code.
   * -------------------------------------------------------------------- */

  /* Column captions that sit beside the brand columns in such a header. */
  var COLUMN_WORD_RE = new RegExp('^(?:x|xx|bs|b\\/s|b\\.s\\.?|sym|symb|symbol|sign|chart|' +
    'colou?r|name|names|note|notes|shade|strands?|skeins?|qty|' +
    'stitch|stitches|count|#|no|nr)[.:]?$', 'i');

  /**
   * A cross-brand key header -> { brand, cols } (cols = how many brand
   * columns the table has), or null. Requires at least one brand word and
   * nothing on the line except brand words and column captions, so a prose
   * line that happens to mention DMC cannot open a key block.
   */
  function brandColumnHeader(line) {
    var s = String(line == null ? '' : line).trim();
    if (!s || s.length > 64) return null;
    var toks = s.replace(/[|,]/g, ' ').split(/\s+/);
    if (!toks.length || toks.length > 8) return null;
    var brands = [], captions = 0, i;
    for (i = 0; i < toks.length; i++) {
      var t = toks[i].replace(/[.:]+$/, '');
      if (!t) continue;
      var b = canonBrand(t);
      if (b) { brands.push(b); continue; }
      if (COLUMN_WORD_RE.test(toks[i])) { captions++; continue; }
      /* a lone glyph is the symbol column's caption on most sheets */
      if (t.length === 1) { captions++; continue; }
      return null;
    }
    /* One brand word on its own is just the word: a header names a brand
       and at least one more column. */
    if (!brands.length || brands.length + captions < 2) return null;
    return { brand: brands[0], cols: brands.length };
  }

  /* ---- transposed keys: one row per brand ---------------------------- *
   * A page whose text runs at 90 degrees comes out of the extractor grouped
   * along the wrong axis, and a Tiny Modernist key then arrives as one line
   * per brand with every code glued together:
   *
   *   DMCEcru3855385433473848
   *
   * Splitting that is only safe when the whole run decomposes into codes the
   * floss table actually knows, so the split is tried longest-first with
   * backtracking and abandoned unless every piece resolves. A brand whose
   * swatches we do not carry (Anchor, Madeira) never decomposes, which is
   * exactly right: its row is the equivalents column, not the key.
   * -------------------------------------------------------------------- */

  var GLUED_BRAND_RE = /^(DMC|Anchor|Madeira|Cosmo|Olympus|Sullivans)([A-Za-z0-9]{6,})$/i;
  var GLUED_PIECE_RES = [/^(B5200)/i, /^(Blanc|White|Ecru)/i, /^(E\d{3,4})/, /^(\d{3,5})/];

  /** Greedy-with-backtracking decomposition of `run` into known codes. */
  function decomposeCodes(run, brand) {
    var out = [];
    function walk(rest) {
      if (!rest.length) return out.length >= 2;
      /* longest plausible piece first, so 3855 wins over 385 */
      var cands = [];
      for (var r = 0; r < GLUED_PIECE_RES.length; r++) {
        var m = GLUED_PIECE_RES[r].exec(rest);
        if (m) cands.push(m[1]);
      }
      var extra = /^\d{4}/.exec(rest);
      if (extra) cands.push(extra[0]);
      var tri = /^\d{3}/.exec(rest);
      if (tri) cands.push(tri[0]);
      cands.sort(function (a, b) { return b.length - a.length; });
      for (var c = 0; c < cands.length; c++) {
        var piece = cands[c];
        if (!keyHexFor(brand, piece)) continue;
        out.push(piece);
        if (walk(rest.slice(piece.length))) return true;
        out.pop();
      }
      return false;
    }
    return walk(run) ? out : null;
  }

  /**
   * '<Brand><code><code>...' -> { brand, codes } when every piece is a floss
   * the table knows and there are at least two of them, else null.
   */
  function splitBrandGlued(token) {
    var m = GLUED_BRAND_RE.exec(String(token == null ? '' : token));
    if (!m) return null;
    var brand = canonBrand(m[1]);
    var codes = decomposeCodes(m[2], brand);
    if (!codes || codes.length < 2) return null;
    return { brand: brand, codes: codes };
  }

  /* ---- chart glyph soup ---------------------------------------------- *
   * When a chart's symbols are real text (Tiny Modernist's "foxy") and the
   * key sits in a sidebar beside the grid, every key row arrives with a few
   * hundred characters of chart glyphs glued to its right-hand end:
   *
   *   '3854 313 16-ct 4.2" x 4.2" p 222222222 u E u E 2222 O 2 O ...'
   *
   * The glyphs give themselves away by repetition: a handful of characters
   * carry most of the line. Characters that occur six times or more are
   * treated as chart ink and the line is cut at the first token built only
   * out of them, which leaves the sidebar text and throws the grid away.
   * -------------------------------------------------------------------- */

  var SOUP_MIN_LEN = 30;        // shorter than this is never chart soup
  var SOUP_MIN_TOKENS = 6;      // the soup has to be a run, not one stray glyph
  var SOUP_MIN_SHARE = 0.9;     // how pure that run has to be
  var SOUP_LONG_RUN = 12;       // a single very long low-entropy token

  /** Distinct characters in a token, counted up to `cap`. */
  function distinctChars(t, cap) {
    var seen = {}, n = 0;
    for (var i = 0; i < t.length; i++) {
      var c = t.charAt(i);
      if (seen[c]) continue;
      seen[c] = 1;
      if (++n > cap) return n;
    }
    return n;
  }

  /** A token that carries no key information: a chart glyph or a run of them. */
  function glyphyToken(t) {
    if (!t || t.length <= 2) return true;             // a lone chart glyph
    /* '222' and '8888' are runs of one chart symbol, not floss codes; a
       real code has more than one distinct digit in it. */
    if (/^\d{3,5}$/.test(t)) return distinctChars(t, 2) < 2;
    if (isWordToken(t)) return false;                 // a colour name
    return distinctChars(t, 3) <= 3;                  // 'OO888OO', '«««', '2222'
  }

  function stripChartSoup(line) {
    var s = String(line == null ? '' : line);
    if (s.length < SOUP_MIN_LEN) return s;

    /* Tokens with their offsets, so the cut keeps the original spacing.
       Runs of spaces are not tokens: a key row padded out into columns
       would otherwise look like a page of blanks. */
    var toks = [], at = [], m, i;
    var re = /\S+/g;
    while ((m = re.exec(s)) !== null) { toks.push(m[0]); at.push(m.index); }
    if (toks.length < SOUP_MIN_TOKENS + 1) return s;

    /* Walk in from the right: the longest suffix that is almost all chart
       glyphs is the grid, and everything before it is the sidebar. */
    var glyphs = 0, cut = -1;
    for (i = toks.length - 1; i >= 0; i--) {
      if (glyphyToken(toks[i])) glyphs++;
      var run = toks.length - i;
      if (run >= SOUP_MIN_TOKENS && glyphs / run >= SOUP_MIN_SHARE && i > 0) cut = i;
    }

    /* A single enormous token of two or three characters is a whole row of
       the chart run together; cut in front of it whatever else is around. */
    for (i = 0; i < toks.length; i++) {
      if (i > 0 && toks[i].length >= SOUP_LONG_RUN && distinctChars(toks[i], 3) <= 3) {
        if (cut < 0 || i < cut) cut = i;
        break;
      }
    }

    /* A key row's own code can look like a glyph run: DMC sells 333, 444,
       666 and 777. When one stands in the first two places ('O 666 46 p
       22222 ...') the cut goes after it, and after the equivalents number
       beside it. */
    if (cut > 0) {
      for (i = 0; i < 2 && i < toks.length; i++) {
        if (/^\d{3,4}$/.test(toks[i]) && keyHexFor('DMC', toks[i]) && cut <= i) {
          cut = i + 1;
          while (cut < toks.length && /^\d{2,5}$/.test(toks[cut]) && distinctChars(toks[cut], 2) >= 2) cut++;
          break;
        }
      }
    }
    if (cut <= 0 || cut >= toks.length) return s;
    return s.slice(0, at[cut]).replace(/\s+$/, '');
  }

  /* ---- a detached stitch-count column -------------------------------- *
   * A sidebar key is two tables side by side, and the extractor's column
   * splitter hands them over one after the other:
   *
   *   X BS DMC Name:        Stitches Length
   *   453 Shell Grey LT     132 28.8 in.
   *   ...                   ...
   *
   * When a 'Stitches' block holds exactly as many numeric rows as the key
   * has countless entries, the two were the same rows on the page and the
   * counts are zipped back on in order. Anything else is left alone.
   * -------------------------------------------------------------------- */

  var COUNT_COLUMN_HEAD_RE = /^\s*(?:stitches|stitch\s*count|no\.?\s*of\s*stitches)(?:\s+(?:and\s+)?(?:length|len|floss|thread|metres?|meters?|inches|in\.?))?\s*:?\s*$/i;
  var COUNT_COLUMN_ROW_RE = /^\s*(\d{1,6})(?:\s+\d+(?:[.,]\d+)?\s*(?:in\.?|inches|cm|m|mm|yd|yds)?\.?)?\s*$/i;

  /**
   * A key row hiding at the end of a line of other furniture: the trailing
   * run of code tokens, when it is no longer than the table's brand columns
   * and its first code is one the floss table knows. Returns that code or
   * null (with opts.withRun, `{ code, run }`, so the caller knows how many
   * of the table's columns the line actually carried). Only ever called
   * inside a cross-brand key block.
   */
  function trailingCodeRow(rawLine, cols, brand, opts) {
    var toks = tokenizeKeyLine(cleanKeyLine(rawLine));
    if (toks.length < 2) return null;
    if (looksLikeGridLine(toks)) return null;
    var start = toks.length;
    while (start > 0 && CODE_TOKEN_RE.test(toks[start - 1])) start--;
    var run = toks.length - start;
    if (run < 1 || run > cols || start === 0) return null;
    /* the token in front has to be something else, or this is a plain
       number run that the ordinary row parser already had its chance at */
    if (CODE_TOKEN_RE.test(toks[start - 1])) return null;
    var code = toks[start];
    if (!keyHexFor(brand || 'DMC', code)) return null;
    return opts && opts.withRun ? { code: code, run: run } : code;
  }

  var COLUMN_FIELD_WORDS = { stitchCount: 'stitch counts', skeins: 'skein numbers' };

  /**
   * Zip the detached columns a page handed over, in the order they were
   * found. Each is `{ field, values }`.
   */
  function zipCountColumns(entries, columns, warnings) {
    for (var c = 0; c < columns.length; c++) {
      if (zipColumn(entries, columns[c].values, columns[c].field)) continue;
      pushOnce(warnings, 'a column of ' +
        (COLUMN_FIELD_WORDS[columns[c].field] || columns[c].field) +
        ' did not line up with the colours');
    }
  }

  /* ---- a detached colour-name column --------------------------------- *
   * The same column splitter that detaches a 'Stitches' column detaches the
   * colour names of a magazine key, which then arrive as a block of bare
   * words a long way below the codes they belong to:
   *
   *   DMC Anchor Madeira            white
   *   Z B5200 1 2401                black
   *   W 310 403 2400                grey
   *
   * A run of plain words with no digits in it, exactly as long as the key
   * has nameless rows, is that column. 'white' would otherwise be read as
   * a key row of its own, so consuming the run fixes two things at once.
   * -------------------------------------------------------------------- */

  var NAME_COLUMN_LINE_RE = /^[A-Za-z][A-Za-z'’\/\- ]{1,23}$/;
  var NAME_COLUMN_MIN = 3;

  /** The run of name-only lines starting at `from`, or null. */
  function nameColumnAt(rawLines, from) {
    var names = [];
    for (var i = from; i < rawLines.length; i++) {
      var line = String(rawLines[i] == null ? '' : rawLines[i]).trim();
      if (!NAME_COLUMN_LINE_RE.test(line)) break;
      if (line.split(/\s+/).length > 3) break;
      if (sectionKindFor(line) || KEY_BLOCK_HEADER_RE.test(line) ||
          brandColumnHeader(line)) break;
      names.push(line);
    }
    return names.length >= NAME_COLUMN_MIN ? { names: names, end: from + names.length - 1 } : null;
  }

  /* ---- zipping a detached column back on -----------------------------
   * A detached column belongs to one block of rows, not to the whole key:
   * a two-column legend hands its skeins over a column at a time, so what
   * we look for is a run of consecutive rows that still have nothing in
   * this field and is exactly as long as the column. Exactly as long, or
   * not at all — a wrong count or a wrong skein number is worse than none.
   * When two runs would fit, the later one wins: columns arrive in reading
   * order, so the block nearest the end is the one just handed over.
   * -------------------------------------------------------------------- */

  function isUnset(v) { return v === null || v === undefined || v === ''; }

  /** Every maximal run of consecutive entries with nothing in `field`. */
  function openRuns(entries, field) {
    var runs = [], cur = null;
    for (var i = 0; i < entries.length; i++) {
      if (isUnset(entries[i][field])) {
        if (!cur) { cur = []; runs.push(cur); }
        cur.push(entries[i]);
      } else {
        cur = null;
      }
    }
    return runs;
  }

  /** Zip one column onto the run it fits. -> true when it fitted. */
  function zipColumn(entries, values, field) {
    if (!values.length) return false;
    var runs = openRuns(entries, field);
    for (var r = runs.length - 1; r >= 0; r--) {
      if (runs[r].length !== values.length) continue;
      for (var i = 0; i < values.length; i++) runs[r][i][field] = values[i];
      return true;
    }
    return false;
  }

  /** Zip a detached name column onto the rows that have no name yet. */
  function zipNameColumn(entries, names) {
    return zipColumn(entries, names, 'name');
  }

  /** The run of numeric rows under a 'Stitches' heading, or null. */
  function countColumnAt(rawLines, from) {
    if (!COUNT_COLUMN_HEAD_RE.test(rawLines[from])) return null;
    var nums = [];
    for (var i = from + 1; i < rawLines.length; i++) {
      var line = rawLines[i];
      if (!String(line).replace(/\s+/g, '')) break;
      var m = COUNT_COLUMN_ROW_RE.exec(line);
      if (!m) break;
      nums.push(parseInt(m[1], 10));
    }
    return nums.length >= 2 ? { nums: nums, end: from + nums.length } : null;
  }

  /* ---- a detached skein column --------------------------------------- *
   * The DMC library legends print two colour columns side by side, each
   * with its own "nº skeins*" column. When the extractor splits them the
   * skein marks arrive on their own:
   *
   *   946                       nº skeins*
   *   947                       no d'echevettes*
   *   967          ->           x1
   *   970                       x1
   *                             x1
   *                             x1
   *
   * A run of lines that is nothing but 'x1' is that column. The header
   * lines above it are left to the ordinary parser, which ignores them.
   * -------------------------------------------------------------------- */

  var SKEIN_COLUMN_ROW_RE = /^\s*(?:x\s*(\d{1,3})|(\d{1,3})\s*(?:x|skeins?|sk))\s*\*?\s*$/i;

  /** The run of bare skein marks starting at `from`, or null. */
  function skeinColumnAt(rawLines, from) {
    var nums = [];
    for (var i = from; i < rawLines.length; i++) {
      var m = SKEIN_COLUMN_ROW_RE.exec(String(rawLines[i] == null ? '' : rawLines[i]));
      if (!m) break;
      nums.push(parseInt(m[1] === undefined ? m[2] : m[1], 10));
    }
    return nums.length >= 2 ? { nums: nums, end: from + nums.length - 1 } : null;
  }

  /* ---- name hygiene --------------------------------------------------- *
   * Fabric counts and finished sizes sit next to the key on a one-page
   * chart and can survive into a colour name when the extractor interleaves
   * the two columns. None of them is ever part of a floss name.
   * --------------------------------------------------------------------- */
  var NAME_JUNK_RE = /^(?:\d{1,2}-?ct|\d+(?:[.,]\d+)?\s*["”']|n\/a|-{2,})$/i;

  function tidyName(name) {
    var toks = String(name == null ? '' : name).split(/\s+/);
    var out = [];
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (!t) continue;
      if (NAME_JUNK_RE.test(t)) continue;
      /* a lone 'x' only survives when it joins two real words */
      if (/^x$/i.test(t) && (!out.length || i === toks.length - 1)) continue;
      out.push(t);
    }
    /* a trailing measurement separator left behind by the cuts above */
    while (out.length && /^x$/i.test(out[out.length - 1])) out.pop();
    return out.join(' ').trim();
  }

  /* Spelled-out strand counts: 'Cross stitch in two strands'. */
  var WORD_NUMS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  var WORD_STRAND_RE = /\b(one|two|three|four|five|six)\s+(?:strands?|threads?)\b/i;

  /* ---- a key printed in newspaper columns, read across --------------- *
   * KG-Chart prints a long key as three columns of 'code (N ct)' read top
   * to bottom. An extractor that treats the page as a table (or pdftotext
   * -layout) hands it over one visual row at a time:
   *
   *   Cross Stitch 798 (2003 ct) 926 (2868 ct)
   *   310 (21207 ct) 3810 (1188 ct) 3837 (827 ct)
   *   ...
   *   3838 (384 ct) 3746 (1158 ct)
   *
   * Such a run is split back into its columns and re-emitted column by
   * column, so the key comes out in printed order. A row that carries words
   * in front of its first cell ('Cross Stitch ...') is missing its left-hand
   * cells, so its cells are right-aligned; any other short row is missing
   * its right-hand ones. The words themselves are kept as a line of their
   * own ahead of the run, where they still switch the section.
   * -------------------------------------------------------------------- */

  var COUNT_CELL_RE = /(?:^|\s)((?:\S{1,2}\s+)?(?:\d{1,5}|B5200|BLANC|Blanc|ECRU|Ecru|WHITE|White)\s*\(\s*\d[\d,]*\s*ct\s*\))/g;

  /* The page footer ('38 / 38', '62 / 62') glued onto a count cell, in
     the middle of a row as well as at its start (see stripFooterGlue). */
  function unglueFooters(line) {
    return String(line)
      .replace(/(^|\s)(\d{1,3})\s*\/\s*\2(\d{3,5})(?=\s*\()/g, '$1$3')
      .replace(/(^|\s)(\d{3,5}?)(\d{1,3})\s*\/\s*\3(?=\s*\()/g, function (all, sp, code, n) {
        return keyHexFor('DMC', code) ? sp + code : all;
      });
  }

  function countCells(line) {
    line = unglueFooters(line);
    var out = [], m, first = -1;
    COUNT_CELL_RE.lastIndex = 0;
    while ((m = COUNT_CELL_RE.exec(line)) !== null) {
      if (first < 0) first = m.index + (m[0].length - m[1].length);
      out.push(m[1].trim());
    }
    return { cells: out, lead: first > 0 ? line.slice(0, first).trim() : '' };
  }

  /* Wave F: this repair is a FALLBACK. Since wave E the extractor hands a
     newspaper-column key over column by column, one 'code (N ct)' per line,
     and that order is the printed one, so it must never be reshuffled. A run
     is only treated as "read across" when at least two of its lines, and at
     least half of them, carry two or more cells; a lone glued line inside an
     otherwise one-per-line key just has its cells split in the order given.
     `expandCountColumns.repaired` says whether any run was re-ordered (it
     becomes parseKey's `keyOrder`). */
  function expandCountColumns(lines) {
    var out = [], i = 0;
    expandCountColumns.repaired = false;
    while (i < lines.length) {
      var c = countCells(lines[i]);
      if (c.cells.length < 2) { out.push(lines[i]); i++; continue; }
      /* a run: this line and every following line that holds count cells */
      var run = [];
      var j = i;
      while (j < lines.length) {
        var cj = j === i ? c : countCells(lines[j]);
        if (!cj.cells.length) break;
        /* a lead that is not plain words (a footer, a stray number) belongs
           to the cell, not to the run */
        if (cj.lead && !/[A-Za-z]{3,}/.test(cj.lead)) { cj.cells[0] = cj.lead + ' ' + cj.cells[0]; cj.lead = ''; }
        run.push(cj);
        j++;
      }
      var width = 0, r, multi = 0;
      for (r = 0; r < run.length; r++) {
        width = Math.max(width, run[r].cells.length);
        if (run[r].cells.length >= 2) multi++;
      }
      if (multi < 2 || multi * 2 < run.length) {
        /* the extractor's own order: keep it, one cell per line */
        for (r = 0; r < run.length; r++) {
          if (run[r].lead) out.push(run[r].lead);
          out.push.apply(out, run[r].cells);
        }
        i = j;
        continue;
      }
      expandCountColumns.repaired = true;
      var cols = [];
      for (r = 0; r < width; r++) cols.push([]);
      for (r = 0; r < run.length; r++) {
        if (run[r].lead) out.push(run[r].lead);
        var shift = run[r].lead ? width - run[r].cells.length : 0;
        for (var k = 0; k < run[r].cells.length; k++) cols[k + shift].push(run[r].cells[k]);
      }
      for (r = 0; r < width; r++) out.push.apply(out, cols[r]);
      i = j;
    }
    return out;
  }

  var SECTION_TESTS = [
    { kind: 'back', re: /back\s*stitch|backstitch|^b\.?\s*s\.?$/i },
    { kind: 'knot', re: /french\s*knot/i },
    { kind: 'bead', re: /\bbead/i },
    { kind: 'half', re: /half\s*stitch|petite|fractional|quarter\s*stitch/i },
    { kind: 'cross', re: /cross\s*stitch|full\s*stitch/i }
  ];

  /**
   * A section header names exactly ONE technique. A line that names two —
   * 'Stitches used: Cross Stitch, Back Stitch', or the trilingual DMC
   * sheets' 'backstitch / point arriere' beside a cross-stitch label — is a
   * summary, not a switch, and letting it switch the section is how a whole
   * key ends up marked as backstitch (brainstorm 04 #17).
   */
  /** Every technique a line names, in the order they appear on it. */
  function kindsNamedIn(line) {
    var found = [];
    for (var t = 0; t < SECTION_TESTS.length; t++) {
      var m = SECTION_TESTS[t].re.exec(String(line));
      if (m) found.push({ kind: SECTION_TESTS[t].kind, at: m.index });
    }
    found.sort(function (a, b) { return a.at - b.at; });
    return found.map(function (f) { return f.kind; });
  }

  function sectionKindFor(line) {
    var s = line.trim();
    if (!s || s.length > 48) return null;
    var hit = null, n = 0;
    for (var i = 0; i < SECTION_TESTS.length; i++) {
      if (SECTION_TESTS[i].re.test(s)) { n++; if (!hit) hit = SECTION_TESTS[i].kind; }
    }
    return n === 1 ? hit : null;
  }

  /* ---------------- wave J: the "Floss list" layout ----------------
   *
   *   Floss list for crosses
   *   Use 2 strands of thread for cross stitch
   *   N Symbol Number Name Stitches
   *   1 <glyph> <glyph on swatch> DMC 04 Tin - Dark 100
   *
   * The symbol column is drawn, so it reaches the text as nothing, a stray
   * character or a private-use code. The rows are recognised by their
   * brand + code, everything in front of the brand is the row number and
   * that symbol junk, and the numbers after the name are the columns the
   * header put there. Only switched on by its own heading or header row, so
   * no other layout's rows go through it. */

  var FL_HEAD_RE = /^\s*floss\s*list\b\s*(?:for\s+)?(.*?)\s*:?\s*$/i;
  var FL_USE_RE = /^\s*use\s+(\d|one|two|three|four|five|six)\s+(?:strands?|threads?)\b(.*)$/i;
  var FL_TOTAL_RE = /^\s*(?:grand\s+)?totals?\b\s*:?/i;
  var FL_BRAND_RE = /(^|[^A-Za-z])(DMC|Anchor|Madeira|Cosmo|Olympus|Sullivans)(?![A-Za-z])/i;
  var FL_CODE_RE = /^\s*[#:.\-]?\s*(B5200|Blanc|Ecru|White|E\d{3,4}|\d{1,5})(?![\dA-Za-z])/i;
  var FL_COLS = {
    n: 'n', no: 'n', 'no.': 'n', '#': 'n', nr: 'n', 'nº': 'n',
    symbol: 'symbol', sym: 'symbol', symb: 'symbol', key: 'symbol',
    number: 'number', code: 'number', floss: 'number', thread: 'number', brand: 'number',
    name: 'name', description: 'name', colour: 'name', color: 'name',
    stitches: 'stitches', count: 'stitches', sts: 'stitches',
    strands: 'strands', strand: 'strands',
    skeins: 'skeins', skein: 'skeins',
    length: 'length'
  };
  var FL_NUMERIC = { stitches: 1, strands: 1, skeins: 1 };
  var FL_SHADE_RE = /^(?:-|very|ultra|light|lt|dark|dk|medium|med|md|pale|bright|deep|soft|vy|ul)$/i;
  var FL_DEFAULT_COLS = ['n', 'symbol', 'number', 'name', 'stitches'];

  /** 'N Symbol Number Name Stitches' -> the column list, or null. */
  function flossListHeader(line) {
    var s = String(line).replace(/stitch\s*count/ig, 'stitches').trim();
    if (!s || s.length > 80) return null;
    var toks = s.split(/\s+/), cols = [];
    for (var i = 0; i < toks.length; i++) {
      var c = FL_COLS[toks[i].toLowerCase()];
      if (!c) return null;
      if (cols.indexOf(c) < 0) cols.push(c);
    }
    if (cols.indexOf('number') < 0 || cols.indexOf('name') < 0 || cols.indexOf('stitches') < 0) return null;
    return cols.length >= 3 ? cols : null;
  }

  /** The section a 'Floss list for …' heading opens. */
  function flossListKind(rest) {
    var s = String(rest || '');
    if (/half|petite|quarter|fractional/i.test(s)) return 'half';
    if (/back\s*stitch/i.test(s)) return 'back';
    if (/knot/i.test(s)) return 'knot';
    if (/bead/i.test(s)) return 'bead';
    return 'cross';
  }

  /* '1,839', '1.839', '1 839' with a no-break or thin space, "1'839" */
  function flUnthousand(s) {
    return s.replace(/(\d)[,.   '’](?=\d{3}(?!\d))/g, '$1');
  }
  /* A space-like thousands separator is only trusted in the LAST number on
     the line (the count), and before the line's spaces are normalised:
     '1 839' is 1839, but '1 310' at the front is row 1, DMC 310. */
  function flSpacedCount(s) {
    return String(s).replace(/(\d)[   ](?=\d{3}(?!\d)\D*$)/, '$1');
  }

  /**
   * One floss-list row, or null. -> { n, symbol, unreadable, brand, code,
   * name, pre: [ints between code and name], post: [ints after the name] }
   */
  function flossListRow(line, docBrand) {
    var s = flSpacedCount(line == null ? '' : line).replace(/[     ]/g, ' ');
    s = s.replace(/[–—]/g, '-');
    if (s.length > 160) return null;
    var prefix, brand, after;
    var bm = FL_BRAND_RE.exec(s);
    if (bm) {
      prefix = s.slice(0, bm.index + bm[1].length);
      brand = canonBrand(bm[2]) || bm[2];
      after = s.slice(bm.index + bm[0].length);
    } else {
      /* No brand printed: '1 04 Tin - Dark 100' needs the row number in
         front of the code to tell them apart. */
      var nb = /^\s*(\d{1,4})\s+((?:[^\sA-Za-z0-9]{1,3}\s+){0,2})(?=(?:B5200|Blanc|Ecru|White|E\d{3,4}|\d{1,5})\s+[A-Za-z])/i.exec(s);
      if (!nb) return null;
      prefix = nb[1] + ' ' + nb[2];
      brand = docBrand || 'DMC';
      after = s.slice(nb[0].length);
    }
    var cm = FL_CODE_RE.exec(after);
    if (!cm) return null;
    var code = cm[1];
    if (NAMED_CODE_RE.test(code)) {
      code = code.charAt(0).toUpperCase() + code.slice(1).toLowerCase();
      if (/^b5200$/i.test(code)) code = 'B5200';
    }

    /* the prefix: an optional row number and the symbol column's junk */
    var n = null, symbol = '', unreadable = false;
    var pm = /^\s*(\d{1,4})(?!\d)/.exec(prefix);
    var junk = prefix;
    if (pm) { n = parseInt(pm[1], 10); junk = prefix.slice(pm[0].length); }
    junk = junk.trim();
    if (junk.length > 16 || /[A-Za-z]{3,}/.test(junk)) return null;   // prose, not a row
    var jt = junk ? junk.split(/\s+/) : [];
    if (jt.length > 4) return null;
    for (var j = 0; j < jt.length; j++) {
      if (hasUnreadableGlyph(jt[j])) { unreadable = true; continue; }
      if (!symbol && jt[j].length <= 2) symbol = jt[j];
    }

    /* the rest: name words and the numeric columns */
    var rest = flUnthousand(after.slice(cm[0].length)).trim();
    rest = rest.replace(/\s+\d+(?:[.,]\d+)?\s*(?:m|cm|mm|in|inches|yds?)\.?\s*$/i, '');   // a length column
    rest = rest.replace(/(\d)\s*(?:sts?|stitches)\.?\s*$/i, '$1');
    var toks = rest ? rest.split(/\s+/) : [];
    var pre = [], post = [];
    while (toks.length && /^\d{1,6}$/.test(toks[0])) pre.push(parseInt(toks.shift(), 10));
    while (toks.length && /^\d{1,7}$/.test(toks[toks.length - 1])) post.unshift(parseInt(toks.pop(), 10));
    if (!toks.length && pre.length && !post.length) { post = pre; pre = []; }
    var joined = toks.join(' ');
    var name = joined.replace(/^[-:|\s]+/, '').replace(/[-:|\s]+$/, '').replace(/\s+/g, ' ');
    if (name && !/[A-Za-z]/.test(name)) return null;
    if (name.split(' ').length > 10) return null;
    return { n: n, symbol: symbol, unreadable: unreadable, brand: brand, code: code,
      name: name, pre: pre, post: post, dangling: /\s-\s*$/.test(' ' + joined) };
  }

  /**
   * The numbers a floss-list row carried, put into the header's columns.
   * Columns after the name are filled from the right ('Golden Brown 2 1184'
   * under '… Name Stitches' is a name with a 2 in it); a number with no
   * column left goes back into the name.
   */
  function flossListFields(row, cols) {
    var nameAt = cols.indexOf('name'), numAt = cols.indexOf('number');
    var before = [], after = [], i;
    for (i = 0; i < cols.length; i++) {
      if (!FL_NUMERIC[cols[i]] && cols[i] !== 'length') continue;
      if (nameAt >= 0 && i < nameAt && i > numAt) before.push(cols[i]);
      else if (nameAt < 0 || i > nameAt) after.push(cols[i]);
    }
    var out = { stitches: null, strands: null, skeins: null, namePre: [], namePost: [] };
    var take = function (vals, names, fromRight) {
      vals = vals.slice();
      names = names.filter(function (c) { return c !== 'length'; });
      var spill = [];
      while (vals.length > names.length) {
        if (fromRight) spill.push(vals.shift());
        else spill.unshift(vals.pop());
      }
      var off = fromRight ? names.length - vals.length : 0;
      for (var k = 0; k < vals.length; k++) out[names[off + k]] = vals[k];
      return spill;
    };
    out.namePost = take(row.post, after, true);
    out.namePre = take(row.pre, before, false);
    /* a 'strands' that is plainly a stitch count was put in the wrong box */
    if (out.strands !== null && out.strands > 12 && out.stitches === null) {
      out.stitches = out.strands; out.strands = null;
    }
    return out;
  }

  /**
   * parseKey(text, opts) -> KeyResult  (B3.3)
   */
  function parseKey(text, opts) {
    opts = isObj(opts) ? opts : {};
    var warnings = [];
    var defaultStrands = clampInt(opts.defaultStrands, 1, 12, 2);
    var brandList = Array.isArray(opts.brands) && opts.brands.length ? opts.brands : BRANDS;
    var brandRe = new RegExp('^(' + brandList.map(function (b) {
      return String(b).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('|') + ')$', 'i');

    var result = {
      entries: [],
      fabric: { count: null, countY: null, over: null, kind: null, color: null },
      design: { w: null, h: null, title: null, designer: null },
      sizes: [],
      strandsDefault: defaultStrands,
      stitchesUsed: [],
      copyrightLines: [],
      declaredColors: null,
      bsStrands: null,
      knotStrands: null,
      confidence: 0,
      /** 'cross-stitch' | 'embroidery' | 'none' — B3.3 step 6. */
      kind: 'none',
      /** true when the file carries no text at all, only page images. */
      imageOnly: false,
      /** Wave F: 'extractor' | 'repaired' — see expandCountColumns. */
      keyOrder: 'extractor',
      /** Wave J: the stitch total a key prints under its rows, or null. */
      totalStitches: null,
      warnings: warnings
    };

    result.kind = 'none';
    result.imageOnly = false;

    var raw = typeof text === 'string' ? text : '';
    /* An image-only chart (a flattened scan, or a Satsuma Street PDF whose
       single page is one big JPEG) has page markers and nothing else. Say so
       in the words a stitcher needs — the pages are still worth importing. */
    var body = raw.replace(/^=== PAGE \d+ ===$/gm, '');
    if (!body.replace(/[\s ]+/g, '')) {
      pushOnce(warnings, 'no text in this file');
      pushOnce(warnings, 'this chart is a picture with no readable text — ' +
        'import the pages as images and add the colours by hand');
      result.imageOnly = true;
      return result;
    }

    var rawLines = expandCountColumns(raw.split(/\r\n|\r|\n/));
    /* 'extractor' when the key's order is the text's own; 'repaired' when a
       newspaper-column key read across had to be put back (the fallback). */
    result.keyOrder = expandCountColumns.repaired ? 'repaired' : 'extractor';

    /* document-level brand hint */
    var docBrand = '';
    if (/\banchor\b/i.test(raw) && !/\bdmc\b/i.test(raw)) docBrand = 'Anchor';
    else if (/\bmadeira\b/i.test(raw) && !/\bdmc\b/i.test(raw)) docBrand = 'Madeira';

    /* ---------------- key rows ---------------- */
    var kind = 'cross';
    var blankRun = 0;
    var anyUnreadable = false;
    var entries = [];
    var byKey = {};
    var inBlock = false;
    /* A cross-brand header is a much stronger signal than 'Colour key' and
       it has to survive the fabric / size furniture that a one-page chart
       interleaves with its sidebar, so it gets its own flag: only a page
       break or a real gap closes it. */
    var brandBlock = false;
    var altCols = 0;            // extra brand columns a cross-brand header declared
    /* Equivalents columns the last key row did not carry. The extractor can
       wrap a row's second brand onto a line of its own ('57h x 80w 958' then
       '844', which is Cosmo 844, not DMC 844), and that line is owed to the
       row above rather than being a colour of its own. */
    var owedAlt = 0;
    var lastRowDmc = false;     // the previous line was a key row we have a swatch for
    var queuedKinds = [];       // side-by-side legends still to come (see kindsNamedIn)
    var headerBrand = '';       // the primary brand that header named
    var countColumns = [];      // detached 'Stitches'/skein columns, zipped on below
    var leadSkeins = [];        // skein marks that belonged to the column left of this one

    /* Document-level facts the row parser needs before it starts. */
    var mEach = SKEIN_EACH_RE.exec(raw);
    var defaultSkeins = mEach ? parseInt(mEach[1], 10) : null;

    /** Add a row, merging it onto an earlier row for the same floss. */
    function addEntry(entry) {
      var mk = (entry.brand || '') + '\u0000' + entry.code.toLowerCase() + '\u0000' + entry.kind;
      var prev = byKey[mk];
      if (!prev) {
        byKey[mk] = entry;
        entries.push(entry);
        return;
      }
      if (entry.stitchCount !== null) {
        prev.stitchCount = prev.stitchCount === null
          ? entry.stitchCount : Math.max(prev.stitchCount, entry.stitchCount);
      }
      if (entry.skeins !== null) {
        prev.skeins = prev.skeins === null ? entry.skeins : Math.max(prev.skeins, entry.skeins);
      }
      if (!prev.symbol && entry.symbol) prev.symbol = entry.symbol;
      if (!prev.name && entry.name) prev.name = entry.name;
      if (prev.strands === null && entry.strands !== null) prev.strands = entry.strands;
    }

    /* Wave J: the "Floss list" layout. `fl` is null until its heading or
       header row is seen; `fl.cur` is the row being built, which a wrapped
       name or a one-cell-per-line extraction finishes on later lines. */
    var fl = null;
    function flFlush() {
      var c = fl && fl.cur;
      if (fl) fl.cur = null;
      if (!c || !c.code) return;
      if (c.unreadable) anyUnreadable = true;
      var f = flossListFields(c, fl.cols);
      var name = f.namePre.concat(c.name ? [c.name] : [], f.namePost).join(' ').trim();
      addEntry({
        symbol: c.symbol, brand: c.brand, code: c.code, name: name,
        strands: f.strands !== null ? f.strands : fl.strands,
        stitchCount: f.stitches, skeins: f.skeins !== null ? f.skeins : defaultSkeins,
        kind: fl.kind, blendCode: null,
        hex: keyHexFor(c.brand, c.code), line: c.lines.join(' / ')
      });
    }
    /** true when the floss-list reader used the line up. */
    function flLine(rawLine) {
      var s = flSpacedCount(rawLine).replace(/[     ]/g, ' ');
      var t = s.trim();
      if (!t || /^={2,}\s*PAGE\b/i.test(t) || /©|\(c\)|copyright|all rights reserved/i.test(t)) {
        flFlush();
        return false;
      }
      var m = FL_HEAD_RE.exec(t);
      if (m && t.length <= 60) {
        flFlush();
        fl.kind = flossListKind(m[1]);
        fl.strands = null;
        kind = fl.kind;
        return true;
      }
      m = FL_USE_RE.exec(t);
      if (m) {
        flFlush();
        var sv = /^\d$/.test(m[1]) ? parseInt(m[1], 10) : WORD_NUMS[m[1].toLowerCase()];
        if (sv >= 1 && sv <= 12) fl.strands = sv;
        return true;
      }
      var hdrCols = flossListHeader(t);
      if (hdrCols) { flFlush(); fl.cols = hdrCols; return true; }
      if (FL_TOTAL_RE.test(t)) {
        flFlush();
        var tt = flUnthousand(t);
        var tm = /(\d+)\s*(?:stitches|sts)\b/i.exec(tt) || /(\d+)\D*$/.exec(tt);
        if (tm && fl.kind === 'cross' && result.totalStitches === null) {
          result.totalStitches = parseInt(tm[1], 10);
        }
        return true;
      }
      var row = flossListRow(t, docBrand);
      if (row) {
        if (fl.cur && !fl.cur.code && row.n === null) {
          /* the row number (and maybe its symbol) came on lines of their own */
          row.n = fl.cur.n;
          if (!row.symbol) row.symbol = fl.cur.symbol;
          row.lines = fl.cur.lines.concat([t]);
        } else {
          flFlush();
          row.lines = [t];
        }
        fl.cur = row;
        return true;
      }
      var cur = fl.cur;
      /* one cell per line: a bare number is this row's count, or the next row's number */
      if (/^\d[\d,. ']*$/.test(t)) {
        var v = parseInt(flUnthousand(t), 10);
        if (cur && cur.code && !cur.post.length) {
          cur.post.push(v); cur.lines.push(t);
          return true;
        }
        if (!cur || cur.code) {
          flFlush();
          if (v < 1000) {
            fl.cur = { n: v, symbol: '', unreadable: false, code: null, name: '', pre: [], post: [], lines: [t] };
            return true;
          }
        }
        return false;
      }
      /* ... and the symbol, when it survived as a glyph on its own line */
      if (cur && !cur.code && t.length <= 3 && !/[A-Za-z0-9]/.test(t)) {
        if (hasUnreadableGlyph(t)) cur.unreadable = true;
        else if (!cur.symbol) cur.symbol = t;
        cur.lines.push(t);
        return true;
      }
      /* A name that wrapped onto the next line, maybe with the count after
         it. Only while the row is visibly unfinished (no count yet, no name
         yet, a name ending in ' -') or when the line is nothing but shade
         words, so a footer under the last row is never glued onto it. */
      if (cur && cur.code && t.length <= 48 && /[A-Za-z]{2,}/.test(t) && !/[:;]/.test(t) &&
          !sectionKindFor(t) && !kindsNamedIn(t).length) {
        var wt = flUnthousand(t).replace(/[–—]/g, '-').split(/\s+/), tailNums = [];
        while (wt.length && /^\d{1,7}$/.test(wt[wt.length - 1])) tailNums.unshift(parseInt(wt.pop(), 10));
        var ok = wt.length > 0 && wt.length <= 6;
        for (var wi = 0; ok && wi < wt.length; wi++) {
          if (/^\d+$/.test(wt[wi])) ok = false;     // 'Page 4 of 5' is not a name
        }
        var unfinished = !cur.post.length || !cur.name || cur.dangling;
        var shadeWords = ok && wt.every(function (w) { return FL_SHADE_RE.test(w); });
        if (ok && (unfinished || shadeWords) && (!tailNums.length || !cur.post.length)) {
          var lead = wt.join(' ').replace(/^-\s*/, '');
          var glue = cur.dangling || /^-/.test(wt[0]) ? ' - ' : ' ';
          cur.name = cur.name ? cur.name + glue + lead : lead;
          cur.dangling = /\s-$/.test(' ' + cur.name);
          cur.name = cur.name.replace(/\s*-\s*$/, '').replace(/\s+/g, ' ').trim();
          if (tailNums.length) cur.post = tailNums;
          cur.lines.push(t);
          return true;
        }
      }
      flFlush();
      return false;
    }

    for (var li = 0; li < rawLines.length; li++) {
      var rawLine = rawLines[li];
      if (!fl && (FL_HEAD_RE.test(rawLine) && rawLine.trim().length <= 60 ||
                  flossListHeader(String(rawLine).trim()))) {
        fl = { cols: FL_DEFAULT_COLS, kind: 'cross', strands: null, cur: null };
      }
      if (fl && flLine(rawLine)) {
        blankRun = 0;
        continue;
      }
      if (/^\s*={2,}\s*PAGE\b/i.test(rawLine)) {                 // PdfText page marker
        inBlock = false;
        brandBlock = false;
        altCols = 0;
        continue;
      }
      // page furniture: '(c) 2026 A Stitcher' would otherwise read as code 2026
      if (/©|\(c\)|copyright|all rights reserved/i.test(rawLine)) continue;
      if (!rawLine.replace(/\s+/g, '')) {
        blankRun++;
        if (blankRun >= 2) { kind = 'cross'; inBlock = false; brandBlock = false; altCols = 0; }
        continue;
      }
      blankRun = 0;
      var prevRowDmc = lastRowDmc;
      lastRowDmc = false;

      if (owedAlt > 0 && brandBlock) {
        var owedToks = tokenizeKeyLine(cleanKeyLine(rawLine));
        var owedAll = owedToks.length > 0 && owedToks.length <= owedAlt;
        for (var ot = 0; owedAll && ot < owedToks.length; ot++) {
          if (!CODE_TOKEN_RE.test(owedToks[ot])) owedAll = false;
        }
        owedAlt = 0;
        if (owedAll) continue;
      }
      owedAlt = 0;

      /* A sidebar key is two tables side by side and the extractor hands
         them over one after the other, so a 'Stitches' column arrives as a
         detached run of numbers. It closes the key block (its rows are not
         key rows) and its numbers are zipped back on at the end. */
      var col = countColumnAt(rawLines, li);
      if (col) {
        countColumns.push({ field: 'stitchCount', values: col.nums });
        inBlock = false;
        li = col.end;
        continue;
      }

      /* ... and the skein marks of a two-column legend, the same way. */
      var skCol = skeinColumnAt(rawLines, li);
      if (skCol) {
        countColumns.push({ field: 'skeins', values: skCol.nums });
        inBlock = false;
        li = skCol.end;
        continue;
      }

      /* ... and the colour names, when they were split off the same way. */
      if (entries.length) {
        var nameCol = nameColumnAt(rawLines, li);
        if (nameCol && zipNameColumn(entries, nameCol.names)) {
          li = nameCol.end;
          inBlock = false;
          continue;
        }
      }

      /* A cross-brand header both opens a key block and says how many
         equivalents columns follow the primary brand's. */
      var hdr = brandColumnHeader(stripChartSoup(rawLine));
      if (hdr) {
        brandBlock = true;
        altCols = hdr.cols - 1;
        headerBrand = hdr.brand;
        continue;
      }

      if (KEY_BLOCK_BREAK_RE.test(rawLine)) inBlock = false;
      else if (KEY_BLOCK_HEADER_RE.test(rawLine) || KEY_BLOCK_TAIL_RE.test(rawLine)) inBlock = true;

      /* A transposed key: one line per brand, every code glued together. */
      var glued = splitBrandGlued(cleanKeyLine(rawLine));
      if (glued) {
        for (var gi = 0; gi < glued.codes.length; gi++) {
          var gCode = glued.codes[gi];
          if (NAMED_CODE_RE.test(gCode)) {
            gCode = gCode.charAt(0).toUpperCase() + gCode.slice(1).toLowerCase();
            if (/^b5200$/i.test(gCode)) gCode = 'B5200';
          }
          addEntry({
            symbol: '', brand: glued.brand, code: gCode, name: '',
            strands: null, stitchCount: null, skeins: defaultSkeins,
            kind: kind, blendCode: null,
            hex: keyHexFor(glued.brand, gCode), line: String(rawLine).trim()
          });
        }
        inBlock = true;
        continue;
      }

      /* The bare-numbers legend shapes first: they never look like prose.
         Not inside a cross-brand table though: there the second number on
         the row is another brand's code, and the 'x N' skein marker would
         swallow a symbol column of letters ('x 741 304 202'). */
      var listed = brandBlock ? null : codeListRow(rawLine, defaultSkeins !== null);
      if (listed && listed.lead !== null && listed.lead !== undefined) leadSkeins.push(listed.lead);
      if (listed && listed.length) {
        for (var ci = 0; ci < listed.length; ci++) {
          var lc = listed[ci];
          var lBrand = docBrand || 'DMC';
          var lCode = lc.code;
          if (NAMED_CODE_RE.test(lCode)) {
            lCode = lCode.charAt(0).toUpperCase() + lCode.slice(1).toLowerCase();
            if (/^b5200$/i.test(lCode)) lCode = 'B5200';
          }
          addEntry({
            symbol: '', brand: lBrand, code: lCode, name: '',
            strands: null, stitchCount: null,
            skeins: lc.skeins === null ? defaultSkeins : lc.skeins,
            kind: kind, blendCode: null,
            hex: keyHexFor(lBrand, lCode), line: String(rawLine).trim()
          });
        }
        continue;
      }
      if (listed) continue;   // recognised as a legend line, but no codes on it

      /* DMC's two-digit 2017 colours only count when the line sits inside
         the DMC column itself: a DMC row above it, a DMC code below it.
         A bare '9' or '20' anywhere else is an Anchor number or a ruler. */
      var dmcTable = brandBlock && headerBrand === 'DMC' && prevRowDmc &&
        nextStartsWithDmc(rawLines, li);
      var entry = parseKeyRow(rawLine, kind, brandRe, docBrand, defaultStrands,
        inBlock || brandBlock, altCols, dmcTable);
      if (entry) {
        if (entry.hex) lastRowDmc = true;
        if (entry.symbolUnreadable) anyUnreadable = true;
        delete entry.symbolUnreadable;
        owedAlt = entry.altOwed || 0;
        delete entry.altOwed;
        addEntry(entry);
        continue;
      }

      /* A one-page chart interleaves its sidebar key with the fabric and
         size block, so a key row can arrive with furniture in front of it
         ('14-ct 4" x 5.7" 725 701'). Inside a cross-brand block the tail of
         such a line is still the key's own columns. */
      var tail = altCols > 0
        ? trailingCodeRow(rawLine, altCols + 1, headerBrand, { withRun: true }) : null;
      if (tail) {
        addEntry({
          symbol: '', brand: headerBrand || docBrand || 'DMC', code: tail.code,
          name: '', strands: null, stitchCount: null, skeins: defaultSkeins,
          kind: kind, blendCode: null,
          hex: keyHexFor(headerBrand || 'DMC', tail.code), line: String(rawLine).trim()
        });
        owedAlt = altCols + 1 - tail.run;
        continue;
      }

      var sk = sectionKindFor(rawLine);
      if (sk) { kind = sk; queuedKinds = []; continue; }
      /* Two legends side by side under one row of headings ('cross stitch
         Use 2 strands  backstitch Use 1 strand'), each closed by its own
         '* 1 skein in each colour': the headings say which table comes
         first, and each footnote moves on to the next one. */
      var both = kindsNamedIn(rawLine);
      if (both.length >= 2) { kind = both[0]; queuedKinds = both.slice(1); continue; }
      if (queuedKinds.length && SKEIN_EACH_RE.test(rawLine)) kind = queuedKinds.shift();
    }

    if (fl) flFlush();

    /* Zip the detached columns back onto the rows they belonged to. The
       marks that were read off the front of a legend row go last, because
       by then the column they sit beside is the only one still open. */
    if (leadSkeins.length >= 2) countColumns.push({ field: 'skeins', values: leadSkeins });
    zipCountColumns(entries, countColumns, warnings);

    /* '* 1 skein in each colour' fills in every row that had no number. */
    if (defaultSkeins !== null) {
      for (var de = 0; de < entries.length; de++) {
        if (entries[de].skeins === null) entries[de].skeins = defaultSkeins;
      }
    }

    for (var ei = 0; ei < entries.length; ei++) {
      var e = entries[ei];
      /* The rows were decided with the pre-2017 table (keyHexFor); the
         2017 colours (DMC 1-35) get their approximate swatch here. */
      if (e.hex === null) e.hex = hexFor(e.brand, e.code);
      if (e.hex === null && (e.brand === 'DMC' || e.brand === '')) {
        if (/^4\d{3}$/.test(e.code)) pushOnce(warnings, 'variegated colours are approximate on screen');
        else pushOnce(warnings, 'no colour data for ' + (e.brand || 'DMC') + ' ' + e.code);
      } else if (e.hex === null && e.brand) {
        pushOnce(warnings, 'no colour data for ' + e.brand + ' threads');
      }
    }
    if (anyUnreadable) pushOnce(warnings, 'symbols unreadable');
    result.entries = entries;

    /* A printed total is a checksum on the rows above it. */
    if (result.totalStitches !== null) {
      var rowSum = 0, allCounted = true;
      for (var ts = 0; ts < entries.length; ts++) {
        if (entries[ts].kind !== 'cross' && entries[ts].kind !== 'blend') continue;
        if (entries[ts].stitchCount === null) allCounted = false;
        else rowSum += entries[ts].stitchCount;
      }
      if (allCounted && rowSum !== result.totalStitches) {
        pushOnce(warnings, 'the key prints a total of ' + fmtInt(result.totalStitches) +
          ' stitches but its rows add up to ' + fmtInt(rowSum) + ' — check the counts');
      }
    }

    /* ---------------- fabric, design, sizes ---------------- */
    var i, line, m;

    for (i = 0; i < rawLines.length; i++) {
      line = rawLines[i];
      if (!line.trim()) continue;

      if (result.fabric.count === null) {
        m = /(\d{2})\s*(?:-|\s)?(?:ct\b|count\b)/i.exec(line);
        if (m) {
          result.fabric.count = parseInt(m[1], 10);
          result.fabric.countY = result.fabric.count;
          result.fabric.color = fabricColorFrom(line) || result.fabric.color;
        }
      }
      if (result.declaredColors === null) {
        for (var dc = 0; dc < DECLARED_COLORS_RES.length; dc++) {
          m = DECLARED_COLORS_RES[dc].exec(line);
          if (m) {
            var declared = parseInt(m[1], 10);
            if (declared > 0 && declared < 2000) result.declaredColors = declared;
            break;
          }
        }
      }

      /* An explicit 'Cloth's Color: White' beats anything guessed from the
         words around the count, so it is allowed to overwrite. */
      for (var cc = 0; cc < CLOTH_COLOR_RES.length; cc++) {
        m = CLOTH_COLOR_RES[cc].exec(line);
        if (m) {
          var clothColor = m[1].replace(/[.;,]\s*$/, '').trim();
          if (clothColor && clothColor.length <= 40) result.fabric.color = clothColor;
          break;
        }
      }

      if (result.fabric.over === null && /over\s*(?:2|two)\b/i.test(line)) result.fabric.over = 2;
      if (result.fabric.kind === null) {
        if (/\baida\b/i.test(line)) result.fabric.kind = 'aida';
        else if (/\bevenweave\b|\blugana\b|\bjobelan\b/i.test(line)) result.fabric.kind = 'evenweave';
        else if (/\blinen\b|\bbelfast\b|\bcashel\b/i.test(line)) result.fabric.kind = 'linen';
      }

      if (result.design.w === null) {
        var dsz = designSizeFromLine(line);
        if (dsz) {
          result.design.w = dsz.w;
          result.design.h = dsz.h;
        }
      }

      var sz = sizeRowFrom(line);
      if (sz) {
        var dup = false;
        for (var z = 0; z < result.sizes.length; z++) if (result.sizes[z].count === sz.count) dup = true;
        if (!dup) result.sizes.push(sz);
      }

      if (/©|\(c\)|copyright/i.test(line)) {
        var cl = line.trim();
        if (cl && result.copyrightLines.indexOf(cl) < 0) result.copyrightLines.push(cl);
      }
    }

    /* '5,5 pts/cm' is the metric way of writing the fabric count. */
    if (result.fabric.count === null) {
      for (i = 0; i < rawLines.length; i++) {
        m = PTS_PER_CM_RE.exec(rawLines[i]);
        if (!m) continue;
        var perCm = parseFloat(m[1].replace(',', '.'));
        if (!(perCm > 0)) continue;
        var asCount = Math.round(perCm * CM_PER_IN);
        if (asCount >= 6 && asCount <= 40) {
          result.fabric.count = asCount;
          result.fabric.countY = asCount;
        }
        break;
      }
    }

    /* '14 HPI (28-count evenweave)': holes per inch at half the thread count
       is the magazine way of saying "stitched over two". */
    if (result.fabric.over === null && result.fabric.count) {
      for (i = 0; i < rawLines.length; i++) {
        m = /\b(\d{1,2})\s*(?:hpi|holes\s*per\s*inch|stitches\s*per\s*inch)\b/i.exec(rawLines[i]);
        if (m && parseInt(m[1], 10) * 2 === result.fabric.count) { result.fabric.over = 2; break; }
      }
    }

    /* Printed finished sizes, checked against the design they belong to.
       Tiny Modernist prints them in the stitch count's own order ('35h x 49w'
       then '2.5" x 3.5"'), so a row that fits better the other way round is
       turned round. KG-Chart prints every size exactly twice what the
       design gives at the stated count (500 stitches at '14 ct./inch' as
       181.42 cm): on linen or evenweave that is the usual over-two, and
       saying so makes the app's own size agree with the sheet; on aida it
       is simply wrong, and the stitcher is told what it really comes to. */
    if (result.design.w && result.design.h && result.sizes.length) {
      var dW = result.design.w, dH = result.design.h, overTwoSeen = false;
      var near2 = function (a, b) { return b > 0 && Math.abs(a / b - 2) <= 0.03; };
      for (z = 0; z < result.sizes.length; z++) {
        var srow = result.sizes[z];
        if (!(srow.count > 0)) continue;
        var ew = dW / srow.count, eh = dH / srow.count;
        var straight = Math.abs(srow.wIn - ew) + Math.abs(srow.hIn - eh);
        var turned = Math.abs(srow.wIn - eh) + Math.abs(srow.hIn - ew);
        if (turned < straight) {
          var tmpW = srow.wIn; srow.wIn = srow.hIn; srow.hIn = tmpW;
        }
        if (near2(srow.wIn, ew) && near2(srow.hIn, eh)) overTwoSeen = srow;
      }
      if (overTwoSeen) {
        var evenish = result.fabric.kind === 'linen' || result.fabric.kind === 'evenweave';
        if (evenish && result.fabric.over === null && result.fabric.count === overTwoSeen.count) {
          result.fabric.over = 2;
        } else if (!evenish && result.fabric.over !== 2) {
          for (z = 0; z < result.sizes.length; z++) {
            var fix = result.sizes[z];
            if (!(fix.count > 0)) continue;
            if (Math.abs(fix.wIn / (dW / fix.count) - 2) <= 0.03) {
              fix.wIn = round2(dW / fix.count);
              fix.hIn = round2(dH / fix.count);
            }
          }
          pushOnce(warnings, 'the printed finished size is twice what ' + dW + ' x ' + dH +
            ' stitches come to on ' + overTwoSeen.count + '-count ' +
            (result.fabric.kind || 'fabric') + ' (it assumes stitching over two): it is really ' +
            round1(dW / overTwoSeen.count) + ' x ' + round1(dH / overTwoSeen.count) + ' in');
        }
      }
    }

    /* strandsDefault: a strand hint near "cross stitch" wins, else any hint.
       Backstitch lines are counted separately; when a sheet contradicts
       itself (the DMC library ones do, because the FR and EN columns bleed
       together) the smaller number is the safer one for backstitch. */
    var strandHint = null;
    var bsHint = null;
    var knotHint = null;
    for (i = 0; i < rawLines.length; i++) {
      line = rawLines[i];
      m = STRAND_RE.exec(line);
      /* Magazines spell it out: 'Cross stitch in two strands'. */
      if (!m) {
        var wm = WORD_STRAND_RE.exec(line);
        if (wm) m = [wm[0], String(WORD_NUMS[wm[1].toLowerCase()])];
      }
      if (!m) continue;
      var v = parseInt(m[1], 10);
      if (!(v >= 1 && v <= 6)) continue;
      var bsAt = /back\s*stitch|point\s*arri/i.exec(line);
      if (bsAt) {
        /* 'cross stitch Use 2 strands  backstitch Use 1 strand': two
           headings on one line, and the backstitch number is the one after
           its own word, while the one before it is the cross stitch's. */
        var after = STRAND_RE.exec(line.slice(bsAt.index));
        if (after && m.index < bsAt.index) {
          var bv = parseInt(after[1], 10);
          if (bv >= 1 && bv <= 6 && (bsHint === null || bv < bsHint)) bsHint = bv;
          if (/cross\s*stitch|point\s*de\s*croix/i.test(line.slice(0, bsAt.index))) strandHint = v;
          continue;
        }
        if (bsHint === null || v < bsHint) bsHint = v;
        continue;
      }
      /* 'French knots in one strand' is not the cross-stitch default. */
      if (/french\s*knots?|point\s*de\s*n(?:oe|œ)ud/i.test(line)) {
        if (knotHint === null) knotHint = v;
        continue;
      }
      if (/cross\s*stitch|point\s*de\s*croix/i.test(line)) { strandHint = v; continue; }
      if (strandHint === null) strandHint = v;
    }
    if (strandHint !== null) result.strandsDefault = strandHint;
    if (bsHint !== null) result.bsStrands = bsHint;
    if (knotHint !== null) result.knotStrands = knotHint;

    /* stitchesUsed */
    result.stitchesUsed = stitchesUsedFrom(raw, rawLines);

    /* title / designer: only from an explicit label, we never guess */
    for (i = 0; i < rawLines.length; i++) {
      line = rawLines[i];
      if (result.design.title === null) {
        m = /^\s*(?:design|pattern|chart|title)\s*(?:name)?\s*:\s*(.+)$/i.exec(line);
        if (m) result.design.title = m[1].trim();
      }
      if (result.design.designer === null) {
        m = /^\s*(?:designer|designed\s*by|by)\s*:\s*(.+)$/i.exec(line);
        if (m) result.design.designer = m[1].trim();
      }
    }

    /* Wave K (audit): a symbol font's glyph run that landed in the name
       column ('Zlnn9999MM', 'fZZyYiiii' on the WOCS robin key) is never a
       colour name. The name is left empty (the app shows the floss table's)
       and the row says so. */
    var soupNames = 0;
    for (i = 0; i < entries.length; i++) {
      if (entries[i].name && nameIsSoup(entries[i].name)) {
        entries[i].name = '';
        entries[i].nameUnreadable = true;
        soupNames++;
      }
    }
    if (soupNames) {
      pushOnce(warnings, soupNames + ' colour ' + plural(soupNames, 'name') + ' could not be read (chart symbols where the name should be)');
    }

    /* ---------------- confidence (B3.3 step 6) ---------------- */
    var nEntries = entries.length;
    var withCount = 0, withSymbol = 0, withName = 0;
    for (i = 0; i < nEntries; i++) {
      if (entries[i].stitchCount !== null) withCount++;
      if (entries[i].symbol) withSymbol++;
      if (entries[i].name) withName++;
    }
    var conf = 0;
    if (nEntries >= 3) conf += 0.4;
    if (result.design.w && result.design.h) conf += 0.2;
    if (result.fabric.count) conf += 0.2;
    if (nEntries && withCount / nEntries >= 0.6) conf += 0.1;
    if (nEntries && withSymbol / nEntries >= 0.6) conf += 0.1;
    /* A key full of real colour names is worth as much as one full of
       symbols: it is what makes a Spriter-style list usable. */
    if (nEntries && withName / nEntries >= 0.6) conf += 0.1;

    var declaredN = result.declaredColors;
    if (declaredN && nEntries) {
      if (Math.abs(nEntries - declaredN) <= Math.max(1, declaredN * 0.1)) conf += 0.1;
      if (nEntries > declaredN * 1.5) {
        conf = Math.min(conf, 0.4);
        pushOnce(warnings, 'found ' + nEntries + ' rows but the pattern says ' + declaredN +
          ' colours — check the list before importing');
      }
    }
    if (conf > 1) conf = 1;
    result.confidence = nEntries ? Math.round(conf * 100) / 100 : 0;

    /* Symbol fonts usually have no ToUnicode map, so a handful of glyphs
       survive extraction and the rest do not. Say so rather than showing a
       half-empty symbol column. */
    if (nEntries && withSymbol > 0 && withSymbol / nEntries < 0.6) {
      pushOnce(warnings, 'most chart symbols could not be read; the app assigns its own');
    }
    if (nEntries && !(result.design.w && result.design.h)) {
      pushOnce(warnings, 'design size not stated');
    }

    /* Surface embroidery sheets rather than half-parsing them: they use
       straight, stem, satin and buttonhole stitch on plain fabric, so there
       is no grid, no count and nothing for a stitch counter to count. */
    var isEmbroidery = EMBROIDERY_STITCH_RE.test(raw) &&
      !/cross\s*stitch|point\s*de\s*croix/i.test(raw) &&
      !/\baida\b/i.test(raw) && !result.fabric.count;
    if (isEmbroidery) {
      pushOnce(warnings, 'this looks like an embroidery pattern, not a counted chart');
      if (result.confidence > 0.2) result.confidence = 0.2;
    }

    if (!nEntries) pushOnce(warnings, 'no colour key found');
    /* Wave K: a key in a brand we have no colour table for (J. & P. Coats
       in the Orr books) is said so, not read as DMC numbers. */
    if (!nEntries && /\bJ\.?\s*(?:&|and)\s*P\.?\s*Coats\b|\bCoats\s*(?:&|and)\s*Clark\b/i.test(String(text || ''))) {
      pushOnce(warnings, 'the key gives J. & P. Coats numbers; there is no colour table for that brand, so its rows are left blank');
    }

    /* What kind of thing did we just read? The importer needs one word for
       the banner, and 'none' is a perfectly good answer for a page of
       alphabets with no key at all. */
    result.kind = isEmbroidery ? 'embroidery'
      : (nEntries || result.design.w || result.fabric.count ? 'cross-stitch' : 'none');
    return result;
  }

  /** The next non-blank line opens with a DMC code we know (after an optional symbol). */
  function nextStartsWithDmc(rawLines, li) {
    for (var j = li + 1; j < rawLines.length && j <= li + 3; j++) {
      var toks = tokenizeKeyLine(cleanKeyLine(rawLines[j]));
      if (!toks.length) continue;
      if (keyHexFor('DMC', toks[0])) return true;
      return toks.length > 1 && toks[0].length <= 2 && !!keyHexFor('DMC', toks[1]);
    }
    return false;
  }

  /** Does this token name a floss the table actually knows? */
  function resolvesAsCode(tok, brand) {
    if (!tok) return false;
    if (NAMED_CODE_RE.test(tok)) return true;
    if (!CODE_TOKEN_RE.test(tok)) return false;
    return !!keyHexFor(brand || 'DMC', tok) || /^\d{3,5}$/.test(tok);
  }

  /**
   * One key row, or null when the line is not a key row.
   * `altCols` is the number of *extra* brand columns a cross-brand header
   * declared, so `Z B5200 1 2401 white` drops the Anchor and Madeira numbers
   * instead of reading them as a colour name or a stitch count.
   */
  /**
   * nameIsSoup(name) -> true when a "name" is chart-symbol glyphs: a word
   * that mixes letters and digits ('Zlnn9999MM'), or three of one character
   * in a row ('fZZyYiiii', 'nnn'). No DMC, Anchor or Madeira name does either.
   */
  function nameIsSoup(name) {
    var toks = String(name || '').split(/\s+/);
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (!t) continue;
      if (/\d/.test(t) && /[A-Za-z]/.test(t) && !/^[A-Za-z]?\d{1,4}[A-Za-z]?$/.test(t)) return true;
      if (/(.)\1\1/.test(t)) return true;
    }
    return false;
  }

  var THREAD_WORD_RE =/^(?:cotton|coton|mouline|mouliné|stranded|floss|perle|pearl|retors|embroidery|special|art\.?)$/i;

  function parseKeyRow(rawLine, kind, brandRe, docBrand, defaultStrands, inBlock, altCols, dmcTable) {
    var cleaned = cleanKeyLine(rawLine);
    if (!cleaned) return null;
    if (cleaned.length > 160) return null;
    altCols = altCols > 0 ? altCols : 0;
    /* A 'Stitches Length' pair on the end of the row ('453 Shell Grey LT
       132 28.8 in.'): the length is floss to buy, not part of the name,
       and the count in front of it is the stitch count. */
    cleaned = cleaned.replace(/(\d)\s+\d+(?:[.,]\d+)?\s*(?:in|inches|cm|mm|m|yds?)\.?$/i, '$1');

    var toks = tokenizeKeyLine(cleaned);
    if (!toks.length) return null;

    /* Chart furniture, whatever the surrounding context — except that a row
       of a cross-brand table is a run of bare ascending numbers too
       ('310 403 2400' is DMC / Anchor / Madeira), so a row that is exactly
       as wide as the header promised and starts with a floss we know is
       spared the margin-ruler test. */
    var brandRow = altCols > 0 && toks.length === altCols + 1 &&
      !!keyHexFor(docBrand || 'DMC', toks[0]);
    if (!brandRow && looksLikeGridLine(toks)) return null;
    /* A line of nothing but chart glyphs ('p 22222 888 <<<<< p') is a row of
       the grid that shared a line with the key. A run of one digit is a
       glyph, not a floss code, so '8888' never becomes DMC 8888. */
    if (toks.length >= 2) {
      var allGlyphs = true;
      for (var g = 0; g < toks.length; g++) {
        if (!glyphyToken(toks[g])) { allGlyphs = false; break; }
        /* ... except that DMC really does sell 333, 444, 666 and 777. On a
           short line ('O 666', a symbol and its code) such a token is the
           floss; a row of the grid is never this short. */
        if (toks.length <= 3 && /^\d{3,4}$/.test(toks[g]) && keyHexFor('DMC', toks[g])) {
          allGlyphs = false;
          break;
        }
      }
      if (allGlyphs) return null;
    }
    // Any other bare run of numbers needs a key header to vouch for it.
    if (!inBlock && allIntegers(toks)) return null;

    /* A symbol column of bare digits ('2', '7', '9' in a magazine key) reads
       as an impossible floss code and the whole row would be thrown away.
       Inside a key block, a short leading token that no floss table knows,
       standing in front of one that every table knows, is the symbol. */
    var forcedSymbol = '';
    if (inBlock && toks.length >= 2 && toks[0].length <= 2 &&
        !resolvesAsCode(toks[0], docBrand) && resolvesAsCode(toks[1], docBrand)) {
      forcedSymbol = toks[0];
      toks = toks.slice(1);
    }

    /* blend, spotted before tokens are consumed */
    var blendCode = null;
    var bm = /\b(\d{3,5}|B5200|Blanc|Ecru|White)\s*(?:\+|\/|&|\band\b)\s*(\d{3,5}|B5200|Blanc|Ecru|White)\b/i.exec(cleaned);

    var i = 0, symbol = forcedSymbol, brand = '', threadWord = false;
    while (i < toks.length) {
      var t = toks[i];
      if (!brand && brandRe.test(t)) { brand = canonBrand(t) || t; i++; continue; }
      /* Wave K (ocr follow-up): "DMC Cotton 816 garnet", the old printed
         style an OCR'd Antique Pattern Library key reads as. A thread word
         straight after the brand is skipped, but then the code must be one
         the brand's table knows (checked below): never a guess. */
      if (brand && !threadWord && THREAD_WORD_RE.test(t)) { threadWord = true; i++; continue; }
      if (CODE_TOKEN_RE.test(t)) break;
      if (i <= 2 && symbolish(t)) { if (!symbol) symbol = t; i++; continue; }
      return null;
    }
    if (i >= toks.length) return null;

    var code = toks[i]; i++;
    if (NAMED_CODE_RE.test(code)) {
      code = code.charAt(0).toUpperCase() + code.slice(1).toLowerCase();
      if (/^b5200$/i.test(code)) code = 'B5200';
    }

    var effBrand = brand || docBrand || '';
    var lookupBrand = effBrand || 'DMC';
    var hex = keyHexFor(lookupBrand, code);

    /* Reject prose: a bare short number with no brand and no DMC match is
       almost always "2 strands throughout" or a margin ruler. A document-level
       brand (an Anchor-only chart) vouches for two-digit codes too, but a
       document-level hint is weak evidence on its own — an Antique Pattern
       Library scan reads "ANCHOR ... 65 BROAD STREET BOSTON MASS." as an
       Anchor 65 — so that case also wants a key header above it. */
    /* DMC's 2017 colours are numbered 1 to 35 ('19' is Medium Light Autumn
       Gold). A bare small number is far more often something else, so they
       only count as codes under a header that names DMC as a column (or
       with the brand written on the row). Their swatches (wave J) are
       filled in after the rows are decided. */
    var newDmc = !!dmcTable && !brand && /^(?:[1-9]|[12]\d|3[0-5])$/.test(code) &&
      !symbol && !(i < toks.length && normUnitWord(toks[i])) &&   // '(2 strands)'
      !new RegExp('\\(\\s*' + code + '\\b').test(rawLine);
    var codeOk = !!hex || !!brand || NAMED_CODE_RE.test(code) || newDmc ||
      /^\d{3,5}$/.test(code) || (!!docBrand && inBlock && /^\d{2}$/.test(code));
    if (!codeOk) return null;
    if (threadWord && !hex) return null;

    /* ---- name + trailing numbers ---- */
    var rest = toks.slice(i);

    /* The equivalents columns a cross-brand header promised: drop that many
       code-shaped tokens straight after the primary code. They are the same
       colour in another brand, never a count and never part of the name. */
    var dropped = 0;
    while (dropped < altCols && rest.length && CODE_TOKEN_RE.test(rest[0])) {
      rest.shift();
      dropped++;
    }
    /* A row that stops short of the table's columns, with nothing after its
       codes, may have had the rest wrapped onto the next line. */
    var altOwed = rest.length ? 0 : altCols - dropped;

    if (bm) {
      blendCode = bm[2];
      // drop the '+ 3799' half of the blend so it never lands in the name
      if (rest.length >= 2 && /^(\+|\/|&|and)$/i.test(rest[0]) &&
          rest[1].toLowerCase() === blendCode.toLowerCase()) {
        rest = rest.slice(2);
      }
    }
    var kinds = [];       // 'num' | 'unit' | 'word'
    var k, tk;
    for (k = 0; k < rest.length; k++) {
      tk = rest[k];
      if (/^\d+$/.test(tk)) kinds.push('num');
      else if (normUnitWord(tk)) kinds.push('unit');
      else if (splitGlued(tk)) kinds.push('glued');
      else kinds.push('word');
    }
    var cut = rest.length;
    while (cut > 0 && kinds[cut - 1] !== 'word') cut--;

    var nameToks = rest.slice(0, cut);
    var tail = rest.slice(cut);

    var labelled = [];
    for (k = 0; k < tail.length; k++) {
      tk = tail[k];
      var g = splitGlued(tk);
      if (g) { labelled.push({ v: g.v, unit: g.unit }); continue; }
      if (/^\d+$/.test(tk)) { labelled.push({ v: parseInt(tk, 10), unit: null }); continue; }
      var u = normUnitWord(tk);
      if (u && labelled.length) {
        var last = labelled[labelled.length - 1];
        if (last.unit === null) last.unit = u;
      }
    }

    var have = { strands: null, stitchCount: null, skeins: null };
    var unlabelled = [];
    var hadUnit = false;
    for (k = 0; k < labelled.length; k++) {
      var L = labelled[k];
      if (L.unit) hadUnit = true;
      if (L.unit === 'strands' && have.strands === null) have.strands = L.v;
      else if (L.unit === 'stitches' && have.stitchCount === null) have.stitchCount = L.v;
      else if (L.unit === 'skeins' && have.skeins === null) have.skeins = L.v;
      else if (L.unit === null) unlabelled.push(L.v);
    }

    var fit = fitNums(unlabelled, have);
    var name = tidyName(nameToks.concat(fit.extra.map(String)).join(' ')
      .replace(/^[-:|\s]+/, '').replace(/[-:|\s]+$/, '').trim());

    /* prose guard: key rows are short */
    var nameWords = name ? name.split(/\s+/).length : 0;
    if (nameWords > 8) return null;
    if (!name && fit.strands === null && fit.stitchCount === null && fit.skeins === null) {
      /* A bare code row is a key row when a key header vouched for the block
         and the code is one we can actually colour in — which is how the
         cross-brand tables ('725 701', '905 327') survive. */
      if (!(inBlock && (hex || symbol || newDmc))) return null;
    }

    /* A key row has to look like one: a counted quantity, a colour name, a
       symbol glyph, a brand word, or a key header vouching for the block. */
    var hasName = /[A-Za-z]{3,}/.test(name);
    if (!inBlock && !hadUnit && !hasName && !symbol && !brand) return null;

    var unreadable = hasUnreadableGlyph(symbol);
    if (unreadable) symbol = '';

    return {
      symbol: symbol,
      brand: effBrand || 'DMC',
      code: code,
      name: name,
      strands: fit.strands === null ? null : fit.strands,
      stitchCount: fit.stitchCount === null ? null : fit.stitchCount,
      skeins: fit.skeins === null ? null : fit.skeins,
      kind: blendCode ? 'blend' : kind,
      blendCode: blendCode,
      hex: hex,
      line: String(rawLine).trim(),
      symbolUnreadable: unreadable,
      altOwed: altOwed
    };
  }

  var FABRIC_WORDS = /^(aida|evenweave|linen|lugana|jobelan|belfast|cashel|fabric|count|ct|zweigart|charles|craft|dmc|opalescent)$/i;

  function fabricColorFrom(line) {
    var m = /([A-Z][a-z’']+(?:\s+[A-Z][a-z’']+){0,2})\s+\d{2}\s*(?:-|\s)?(?:ct\b|count\b)/.exec(line);
    if (!m) m = /\d{2}\s*(?:-|\s)?(?:ct\b|count\b)\s+([A-Z][a-z’']+(?:\s+[A-Z][a-z’']+){0,2})/.exec(line);
    if (!m) return null;
    var words = m[1].split(/\s+/);
    while (words.length && FABRIC_WORDS.test(words[words.length - 1])) words.pop();
    while (words.length && FABRIC_WORDS.test(words[0])) words.shift();
    var out = words.join(' ').trim();
    return out || null;
  }

  /* 'in', 'inch', 'inches' or a double-quote mark, straight or curly
     (Tiny Modernist prints '14-ct 2.5” x 3.5”' and '16-ct 2" x 3"' on
     consecutive lines). */
  var IN = '(?:in\\b|inch(?:es)?\\b|["”“″])';
  /* '14 ct', '14ct', '14-ct', '14 count', '14-count' */
  var CT = '\\s*-?\\s*(?:ct\\b|count\\b)';

  /* Built once: parseKey runs these over every line of a 100 kB extraction,
     and `new RegExp` per line was the single most expensive thing it did. */
  var SIZE_RES = [
    /* '5.1" x 5.1" on 14 ct' — the unit after the first number */
    { re: new RegExp('(\\d+(?:\\.\\d+)?)\\s*' + IN + '\\s*(?:x|\u00D7)\\s*(\\d+(?:\\.\\d+)?)\\s*' + IN + '?[^\\n]*?(\\d{2})' + CT, 'i'), c: 3, w: 1, h: 2, cm: false },
    /* '6.36 x 5.29 in on 14 ct' — the unit only after the second number */
    { re: new RegExp('(\\d+(?:\\.\\d+)?)\\s*(?:x|\u00D7)\\s*(\\d+(?:\\.\\d+)?)\\s*' + IN + '[^\\n]*?(\\d{2})' + CT, 'i'), c: 3, w: 1, h: 2, cm: false },
    /* '14 ct: 6.36 x 5.29 inches' */
    { re: new RegExp('(\\d{2})' + CT + '[^\\n]*?(\\d+(?:\\.\\d+)?)\\s*' + IN + '?\\s*(?:x|\u00D7)\\s*(\\d+(?:\\.\\d+)?)\\s*' + IN, 'i'), c: 1, w: 2, h: 3, cm: false },
    /* '71.12 cm x 91.44 cm (16 ct./inch)' */
    { re: new RegExp('(\\d+(?:\\.\\d+)?)\\s*cm\\s*(?:x|\u00D7)\\s*(\\d+(?:\\.\\d+)?)\\s*cm[^\\n]*?(\\d{2})' + CT, 'i'), c: 3, w: 1, h: 2, cm: true },
    { re: new RegExp('(\\d{2})' + CT + '[^\\n]*?(\\d+(?:\\.\\d+)?)\\s*(?:cm)?\\s*(?:x|\u00D7)\\s*(\\d+(?:\\.\\d+)?)\\s*cm', 'i'), c: 1, w: 2, h: 3, cm: true }
  ];

  function sizeRowFrom(line) {
    for (var i = 0; i < SIZE_RES.length; i++) {
      var spec = SIZE_RES[i];
      var m = spec.re.exec(line);
      if (!m) continue;
      var w = parseFloat(m[spec.w]);
      var h = parseFloat(m[spec.h]);
      if (spec.cm) { w /= CM_PER_IN; h /= CM_PER_IN; }
      return { count: parseInt(m[spec.c], 10), wIn: round2(w), hIn: round2(h) };
    }
    return null;
  }

  /* Design size in stitches. The first four are the forms parseKey has
     always read (their order and their looseness are kept exactly, the
     fixtures depend on it); the rest are wave J's, and they refuse a pair
     that is really a measurement ('5.9 x 8.2"', '15 x 21 cm'). */
  var NOT_A_MEASURE = '(?![.,]\\d)(?!\\s*(?:cm|mm|in\\b|inch|["”″\']))';
  var DESIGN_SIZE_RES = [
    { re: /stitch(?:es)?\s*count\s*:?\s*(\d+)\s*(?:w|x|×|wide|by)\s*(\d+)/i, w: 1, h: 2 },
    { re: /(\d+)\s*(?:w|wide)\s*(?:x|×|by)\s*(\d+)\s*(?:h|high)/i, w: 1, h: 2 },
    { re: /design\s*(?:area|size)\s*:?\s*(\d+)\s*(?:x|×)\s*(\d+)/i, w: 1, h: 2 },
    /* Height first is just as common: '35h x 49w' (Tiny Modernist),
       'MAXIMUM STITCH COUNT 32 high x 56 wide' (a magazine chart). */
    { re: /\b(\d+)\s*(?:h\b|high)\s*(?:x|×|by)\s*(\d+)\s*(?:w\b|wide)/i, w: 2, h: 1 },
    /* wave J */
    { re: new RegExp('design\\s*(?:area|size)\\s*:?\\s*(\\d{1,4})\\s*by\\s*(\\d{1,4})\\b' + NOT_A_MEASURE, 'i'), w: 1, h: 2 },
    { re: /(?:^|[^\d.,])(\d{1,4})\s*(?:x|×|by)\s*(\d{1,4})\s*(?:stitch(?:es)?|sts)\b/i, w: 1, h: 2 },
    { re: new RegExp('\\b(?:size|dimensions?|stitches)\\s*(?:in\\s*stitches\\s*)?:?\\s*(\\d{1,4})\\s*(?:x|×|by)\\s*(\\d{1,4})\\b' + NOT_A_MEASURE, 'i'), w: 1, h: 2 }
  ];

  /** One line's design size in stitches, or null. */
  function designSizeFromLine(line) {
    var s = String(line == null ? '' : line);
    if (!/\d/.test(s)) return null;
    for (var i = 0; i < DESIGN_SIZE_RES.length; i++) {
      var spec = DESIGN_SIZE_RES[i];
      var m = spec.re.exec(s);
      if (!m) continue;
      var w = parseInt(m[spec.w], 10), h = parseInt(m[spec.h], 10);
      if (i >= 4 && !(w > 0 && h > 0)) continue;
      return { w: w, h: h };
    }
    return null;
  }

  /**
   * designSize(text) -> { w, h, source } | null      (wave J)
   * The declared design size in stitches: 'Design size: 144 x 85 stitches',
   * 'Stitch count: 144w x 85h', '35h x 49w', '144 x 85 stitches',
   * 'Size: 144 by 85'. The first line that says it wins, the same rule
   * parseKey uses for `design`. `source` is that line as printed (trimmed),
   * so the app can show where the number came from.
   */
  function designSize(text) {
    var lines = String(text == null ? '' : text).split(/\r\n|\r|\n/);
    for (var i = 0; i < lines.length; i++) {
      var d = designSizeFromLine(lines[i]);
      if (d && d.w > 0 && d.h > 0) {
        return { w: d.w, h: d.h, source: lines[i].replace(/\s+/g, ' ').trim().slice(0, 120) };
      }
    }
    return null;
  }

  var STITCH_TYPES = [
    { name: 'cross-stitch', re: /cross\s*stitch/i },
    { name: 'half stitch', re: /half\s*stitch/i },
    { name: 'quarter stitch', re: /quarter\s*stitch|three[\s-]*quarter/i },
    { name: 'backstitch', re: /back\s*stitch|backstitch/i },
    { name: 'french knot', re: /french\s*knot/i },
    { name: 'bead', re: /\bbeads?\b/i },
    { name: 'long stitch', re: /long\s*stitch/i }
  ];

  function stitchesUsedFrom(raw, rawLines) {
    var scope = null;
    for (var i = 0; i < rawLines.length; i++) {
      var m = /stitch(?:es)?\s*used\s*:?\s*(.*)$/i.exec(rawLines[i]);
      if (m) { scope = m[1] || ''; break; }
    }
    var hay = scope !== null && scope.replace(/\s+/g, '') ? scope : raw;
    var out = [];
    for (var k = 0; k < STITCH_TYPES.length; k++) {
      if (STITCH_TYPES[k].re.test(hay)) out.push(STITCH_TYPES[k].name);
    }
    return out;
  }

  /* ================================================================== *
   * 10. Printable chart (B7)
   * ================================================================== */

  var PRINT_CELL = 10;           // SVG user units per stitch
  var PRINT_PAD = { l: 26, t: 22, r: 16, b: 16 };
  var PRINT_MAX_W_MM = 188;      // narrower of A4 (210) and Letter (216), less margins
  var PRINT_MAX_H_MM = 186;      // leaves room for the repeated key under the grid

  function pageLabel(tx, ty) {
    var s = '', n = tx;
    do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
    return s + (ty + 1);
  }

  /** '#rrggbb' for a palette entry, never empty. */
  function printHex(entry) {
    var h = entry && entry.hex ? String(entry.hex).replace(/^#/, '') : '';
    return /^[0-9a-fA-F]{6}$/.test(h) ? '#' + h : '#808080';
  }

  function inkFor(entry, color) {
    if (!color) return '#111111';
    return symbolInk(entry && entry.hex ? entry.hex : '808080') === 'light' ? '#ffffff' : '#111111';
  }

  /** '#rrggbb' blended 45% towards white — the printed cell wash. */
  function washHex(hexWithHash) {
    var r = parseInt(hexWithHash.substr(1, 2), 16);
    var g = parseInt(hexWithHash.substr(3, 2), 16);
    var b = parseInt(hexWithHash.substr(5, 2), 16);
    return '#' + hex6(
      Math.round(r + (255 - r) * 0.45),
      Math.round(g + (255 - g) * 0.45),
      Math.round(b + (255 - b) * 0.45)
    );
  }

  /** The symbol actually printed for each palette index (never blank, never a dupe). */
  function printSymbols(palette) {
    var out = [], i, s, seen = {};
    for (i = 0; i < palette.length; i++) {
      s = str(palette[i].symbol, '').charAt(0);
      if (!s || seen[s]) s = '';
      if (s) seen[s] = 1;
      out.push(s);
    }
    for (i = 0; i < out.length; i++) {
      if (out[i]) continue;
      for (var k = 0; k < SYMBOLS.length; k++) {
        if (!seen[SYMBOLS[k]]) { out[i] = SYMBOLS[k]; seen[SYMBOLS[k]] = 1; break; }
      }
      if (!out[i]) out[i] = String(i % 10);
    }
    return out;
  }

  function skeinTextFor(stitches, strands, fabric) {
    var n = clampInt(stitches, 0, 1e9, 0);
    if (!n) return '';
    var r = skeinRange({
      stitchCount: n, count: fabric.count, over: fabric.over, strands: strands
    });
    return r.low === r.high ? String(r.low) : (r.low + '–' + r.high);
  }

  /** One chart tile as a self-contained <svg> string. */
  function tileSvg(o) {
    var cells = o.cells, W = o.W;
    var x0 = o.x0, y0 = o.y0, cols = o.cols, rows = o.rows;
    var color = o.color, syms = o.syms, palette = o.palette;
    var C = PRINT_CELL, P = PRINT_PAD;
    var vbW = P.l + cols * C + P.r, vbH = P.t + rows * C + P.b;
    var scale = Math.min(PRINT_MAX_W_MM / vbW, PRINT_MAX_H_MM / vbH);
    var out = [];
    var x, y, i, v;

    out.push('<svg class="grid" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
      vbW + ' ' + vbH + '" width="' + round2(vbW * scale) + 'mm" height="' +
      round2(vbH * scale) + 'mm" role="img" aria-label="Chart page ' + xmlEsc(o.label) + '">');
    out.push('<rect x="' + P.l + '" y="' + P.t + '" width="' + (cols * C) +
      '" height="' + (rows * C) + '" fill="#ffffff"/>');

    /* Colour fills: horizontal runs, one <path> per colour. A 500x500 chart is
       70-odd pages, so this is the difference between a 5 MB page and a 12 MB
       one. The colour is pre-blended towards white rather than drawn with
       fill-opacity, because printers handle flat fills far more predictably. */
    if (color) {
      var runsBy = {}, runOrder = [];
      for (y = 0; y < rows; y++) {
        var run = -2, runStart = 0;
        for (x = 0; x <= cols; x++) {
          v = x < cols ? cells[(y0 + y) * W + (x0 + x)] : -2;
          if (v !== run) {
            if (run >= 0) {
              if (!runsBy[run]) { runsBy[run] = []; runOrder.push(run); }
              var rw = (x - runStart) * C;
              runsBy[run].push('M' + (P.l + runStart * C) + ' ' + (P.t + y * C) +
                'h' + rw + 'v' + C + 'h-' + rw + 'z');
            }
            run = v; runStart = x;
          }
        }
      }
      for (i = 0; i < runOrder.length; i++) {
        out.push('<path fill="' + washHex(printHex(palette[runOrder[i]])) +
          '" d="' + runsBy[runOrder[i]].join('') + '"/>');
      }
    }

    /* Wave K (#19): done squares hatched, so the print shows what is left */
    if (o.done) {
      var hd = [];
      for (y = 0; y < rows; y++) {
        var hr = -1;
        for (x = 0; x <= cols; x++) {
          var ci2 = (y0 + y) * W + (x0 + x);
          var on = x < cols && cells[ci2] >= 0 && ((o.done[ci2 >> 3] || 0) >> (ci2 & 7)) & 1;
          if (on && hr < 0) hr = x;
          if (!on && hr >= 0) {
            hd.push('M' + (P.l + hr * C) + ' ' + (P.t + y * C) + 'h' + ((x - hr) * C) + 'v' + C + 'h-' + ((x - hr) * C) + 'z');
            hr = -1;
          }
        }
      }
      if (hd.length) {
        out.push('<defs><pattern id="hatch-' + xmlEsc(o.label).replace(/[^A-Za-z0-9]/g, '') + '" width="4" height="4" patternUnits="userSpaceOnUse">' +
          '<path d="M0 4L4 0" stroke="#555555" stroke-width="0.8"/></pattern></defs>');
        out.push('<path class="done" fill="url(#hatch-' + xmlEsc(o.label).replace(/[^A-Za-z0-9]/g, '') + ')" d="' + hd.join('') + '"/>');
      }
    }

    /* minor grid and 10x10 majors: one <path> each */
    var d = [], dm = [];
    for (x = 0; x <= cols; x++) {
      ((x0 + x) % 10 === 0 ? dm : d).push('M' + (P.l + x * C) + ' ' + P.t + 'V' + (P.t + rows * C));
    }
    for (y = 0; y <= rows; y++) {
      ((y0 + y) % 10 === 0 ? dm : d).push('M' + P.l + ' ' + (P.t + y * C) + 'H' + (P.l + cols * C));
    }
    if (d.length) out.push('<path d="' + d.join('') + '" stroke="#b9b9b9" stroke-width="0.4" fill="none"/>');
    if (dm.length) out.push('<path d="' + dm.join('') + '" stroke="#333333" stroke-width="1" fill="none"/>');
    out.push('<rect x="' + P.l + '" y="' + P.t + '" width="' + (cols * C) + '" height="' +
      (rows * C) + '" stroke="#111111" stroke-width="1.4" fill="none"/>');

    /* symbols: one <text> per row per ink colour, glyphs placed by an x list */
    var inks = {};
    for (i = 0; i < palette.length; i++) {
      inks[i] = color
        ? (symbolInk(washHex(printHex(palette[i])).slice(1)) === 'light' ? '#ffffff' : '#111111')
        : '#111111';
    }
    for (y = 0; y < rows; y++) {
      var byInk = {}, order = [];
      for (x = 0; x < cols; x++) {
        v = cells[(y0 + y) * W + (x0 + x)];
        if (v < 0 || v >= palette.length) continue;
        var ink = inks[v];
        if (!byInk[ink]) { byInk[ink] = { xs: [], s: [] }; order.push(ink); }
        byInk[ink].xs.push(P.l + x * C + C / 2);
        byInk[ink].s.push(syms[v]);
      }
      for (i = 0; i < order.length; i++) {
        var g = byInk[order[i]];
        out.push('<text x="' + g.xs.join(' ') + '" y="' + (P.t + y * C + C * 0.74) +
          '" fill="' + order[i] + '" font-size="' + (C * 0.8) +
          '" text-anchor="middle" font-family="DejaVu Sans, Segoe UI Symbol, Arial, sans-serif">' +
          xmlEsc(g.s.join('')) + '</text>');
      }
    }

    /* backstitch and knots that fall on this tile */
    var bs = o.back, bd = [];
    for (i = 0; i < bs.length; i++) {
      var b = bs[i];
      if (Math.max(b.x1, b.x2) < x0 || Math.min(b.x1, b.x2) > x0 + cols) continue;
      if (Math.max(b.y1, b.y2) < y0 || Math.min(b.y1, b.y2) > y0 + rows) continue;
      bd.push('M' + round2(P.l + (b.x1 - x0) * C) + ' ' + round2(P.t + (b.y1 - y0) * C) +
        'L' + round2(P.l + (b.x2 - x0) * C) + ' ' + round2(P.t + (b.y2 - y0) * C));
    }
    if (bd.length) out.push('<path d="' + bd.join('') + '" stroke="#111111" stroke-width="1.6" ' +
      'stroke-linecap="round" fill="none"/>');
    for (i = 0; i < o.knots.length; i++) {
      var kp = o.knots[i];
      if (kp.x < x0 || kp.x > x0 + cols || kp.y < y0 || kp.y > y0 + rows) continue;
      out.push('<circle cx="' + round2(P.l + (kp.x - x0) * C) + '" cy="' +
        round2(P.t + (kp.y - y0) * C) + '" r="' + (C * 0.24) + '" fill="#111111"/>');
    }

    /* Wave K (#19): the overlap from the neighbouring pages, greyed */
    if (o.core) {
      var gx0 = (o.core.x0 - x0) * C, gy0 = (o.core.y0 - y0) * C, gx1 = (o.core.x1 + 1 - x0) * C, gy1 = (o.core.y1 + 1 - y0) * C;
      out.push('<path class="overlap" fill="#ffffff" fill-opacity="0.6" fill-rule="evenodd" d="M' + P.l + ' ' + P.t +
        'h' + (cols * C) + 'v' + (rows * C) + 'h-' + (cols * C) + 'z M' + (P.l + gx0) + ' ' + (P.t + gy0) +
        'H' + (P.l + gx1) + 'V' + (P.t + gy1) + 'H' + (P.l + gx0) + 'z"/>');
    }
    /* parked threads: a corner triangle in the floss colour */
    var parks = o.parking || [];
    for (i = 0; i < parks.length; i++) {
      var pk = parks[i];
      if (typeof pk.x !== 'number' || pk.x < x0 || pk.x >= x0 + cols || pk.y < y0 || pk.y >= y0 + rows) continue;
      var cx0 = P.l + (pk.x - x0) * C, cy0 = P.t + (pk.y - y0) * C, t3 = C * 0.55;
      var corner = pk.corner || 'tl', fx = corner.charAt(1) === 'r' ? cx0 + C : cx0, fy = corner.charAt(0) === 'b' ? cy0 + C : cy0;
      var sx = corner.charAt(1) === 'r' ? -t3 : t3, sy = corner.charAt(0) === 'b' ? -t3 : t3;
      var pe = palette[pk.paletteIndex];
      out.push('<path class="park" d="M' + fx + ' ' + fy + 'h' + sx + 'L' + fx + ' ' + (fy + sy) + 'Z" fill="' +
        (pe ? printHex(pe) : '#111111') + '" stroke="#111111" stroke-width="0.4"/>');
    }

    /* margin numbering every 10 stitches, top/bottom and both sides */
    for (x = 0; x <= cols; x++) {
      var ax = x0 + x;
      if (ax % 10 !== 0 || ax === 0) continue;
      out.push('<text class="rule" x="' + (P.l + x * C) + '" y="' + (P.t - 4) +
        '" text-anchor="middle" font-size="7">' + ax + '</text>');
      out.push('<text class="rule" x="' + (P.l + x * C) + '" y="' + (P.t + rows * C + 9) +
        '" text-anchor="middle" font-size="7">' + ax + '</text>');
    }
    for (y = 0; y <= rows; y++) {
      var ay = y0 + y;
      if (ay % 10 !== 0 || ay === 0) continue;
      out.push('<text class="rule" x="' + (P.l - 3) + '" y="' + (P.t + y * C + 2.5) +
        '" text-anchor="end" font-size="7">' + ay + '</text>');
      out.push('<text class="rule" x="' + (P.l + cols * C + 3) + '" y="' + (P.t + y * C + 2.5) +
        '" font-size="7">' + ay + '</text>');
    }

    /* centre arrows */
    var cxAbs = Math.floor(o.designW / 2), cyAbs = Math.floor(o.designH / 2);
    if (cxAbs >= x0 && cxAbs <= x0 + cols) {
      var px = P.l + (cxAbs - x0) * C;
      out.push('<path d="M' + (px - 4) + ' ' + (P.t - 11) + 'L' + (px + 4) + ' ' + (P.t - 11) +
        'L' + px + ' ' + (P.t - 3) + 'Z" fill="#111111"/>');
      out.push('<path d="M' + (px - 4) + ' ' + (P.t + rows * C + 11) + 'L' + (px + 4) + ' ' +
        (P.t + rows * C + 11) + 'L' + px + ' ' + (P.t + rows * C + 3) + 'Z" fill="#111111"/>');
    }
    if (cyAbs >= y0 && cyAbs <= y0 + rows) {
      var py = P.t + (cyAbs - y0) * C;
      out.push('<path d="M' + (P.l - 13) + ' ' + (py - 4) + 'L' + (P.l - 13) + ' ' + (py + 4) +
        'L' + (P.l - 5) + ' ' + py + 'Z" fill="#111111"/>');
      out.push('<path d="M' + (P.l + cols * C + 13) + ' ' + (py - 4) + 'L' + (P.l + cols * C + 13) +
        ' ' + (py + 4) + 'L' + (P.l + cols * C + 5) + ' ' + py + 'Z" fill="#111111"/>');
    }

    out.push('</svg>');
    return out.join('');
  }

  function keyStrip(palette, syms, used, color) {
    var out = ['<ul class="keystrip">'];
    for (var i = 0; i < palette.length; i++) {
      if (used && !used[i]) continue;
      var e = palette[i];
      out.push('<li><span class="sw" style="background:' +
        (color ? printHex(e) : '#ffffff') + ';color:' + inkFor(e, color) + '">' +
        xmlEsc(syms[i]) + '</span><span class="kc">' + xmlEsc(e.code) + '</span></li>');
    }
    out.push('</ul>');
    return out.join('');
  }

  var PRINT_CSS = [
    '*{box-sizing:border-box}',
    'html,body{margin:0;padding:0;background:#fff;color:#111;',
    'font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;font-size:11pt;line-height:1.4}',
    '@page{margin:9mm}',
    '.page{padding:0 0 6mm;page-break-after:always;break-after:page}',
    '.page:last-child{page-break-after:auto;break-after:auto}',
    'h1{font-size:19pt;margin:0 0 2mm}',
    'h2{font-size:12pt;margin:0 0 2mm;font-weight:600}',
    '.sub{color:#555;margin:0 0 4mm}',
    'table{border-collapse:collapse;width:100%;font-size:9.5pt}',
    'th,td{border:1px solid #bbb;padding:1.2mm 2mm;text-align:left}',
    'th{background:#f1f1f1;font-weight:600}',
    'td.n,th.n{text-align:right}',
    '.facts{width:auto;margin:0 0 5mm}',
    '.facts td{border:0;padding:0.6mm 5mm 0.6mm 0}',
    '.sw{display:inline-block;width:5.4mm;height:5.4mm;line-height:5.4mm;text-align:center;',
    'border:1px solid #777;font-size:8pt;vertical-align:middle}',
    '.grid{display:block;margin:0 auto}',
    '.grid text.rule{fill:#444}',
    '.keystrip{list-style:none;margin:3mm 0 0;padding:0;font-size:7.5pt;',
    'display:flex;flex-wrap:wrap}',
    '.keystrip li{display:flex;align-items:center;margin:0 3mm 1mm 0}',
    '.keystrip .sw{width:4.2mm;height:4.2mm;line-height:4.2mm;font-size:6.5pt;margin-right:1mm}',
    '.pagehead{display:flex;justify-content:space-between;align-items:baseline;',
    'margin:0 0 2mm;font-size:9.5pt;color:#444}',
    '.pagehead .tag{font-size:14pt;font-weight:700;color:#111;margin-right:6mm;flex:none}',
    '.note{color:#555;font-size:9pt;margin:4mm 0 0}',
    '.noprint{margin:0 0 4mm;padding:2mm 3mm;border:1px dashed #999;color:#555;font-size:9pt}',
    '@media print{.noprint{display:none}}'
  ].join('');

  /**
   * printableHTML(data, opts) -> string (B7)
   *
   * A self-contained printable page: a cover block (title, designer, design
   * size, finished size at 14/16/18 ct, fabric, strands and the floss list
   * with symbol swatch, code, name, stitch count and skein range), then the
   * chart tiled at `opts.stitchesPerPage` with 10x10 majors, margin numbering
   * every 10, centre arrows, page labels (A1, A2…) and the key repeated under
   * every chart page. No scripts, no external assets: the caller prints it.
   *
   * opts = { color: true, stitchesPerPage: { w: 60, h: 80 } | number,
   *          key: true, title: '', counts: [14, 16, 18] }
   */
  function printableHTML(data, opts) {
    data = isObj(data) ? data : {};
    opts = isObj(opts) ? opts : {};
    var color = opts.color !== false;
    var withKey = opts.key !== false;

    var spp = opts.stitchesPerPage;
    var sppW = 60, sppH = 80;
    if (typeof spp === 'number') { sppW = sppH = clampInt(spp, 10, 200, 60); }
    else if (isObj(spp)) {
      sppW = clampInt(spp.w, 10, 200, 60);
      sppH = clampInt(spp.h, 10, 200, 80);
    }

    var design = isObj(data.design) ? data.design : {};
    var rawFabric = isObj(data.fabric) ? data.fabric : {};
    var fabric = {
      count: clampInt(rawFabric.count, 1, 40, 14),
      over: rawFabric.over === 2 ? 2 : 1,
      kind: str(rawFabric.kind, 'aida'),
      color: str(rawFabric.color, 'White')
    };
    var strandsDefault = clampInt(data.strandsDefault, 1, 12, 2);

    var palette = [];
    var rawPal = Array.isArray(data.palette) ? data.palette : [];
    for (var pi = 0; pi < rawPal.length; pi++) {
      palette.push(normalizePaletteEntry(rawPal[pi], pi, strandsDefault));
    }
    var syms = printSymbols(palette);

    var c = chartCells(data.chart);
    var W = c ? c.w : clampInt(design.w, 0, 20000, 0);
    var H = c ? c.h : clampInt(design.h, 0, 20000, 0);
    var title = str(opts.title, '') || str(design.title, '') || 'Cross-stitch chart';

    /* per-colour stitch counts: recovered from the chart when there is one */
    var counts = [], ci;
    for (ci = 0; ci < palette.length; ci++) counts.push(clampInt(palette[ci].stitchCount, 0, 1e9, 0));
    if (c) {
      for (ci = 0; ci < palette.length; ci++) counts[ci] = 0;
      for (var q = 0; q < c.cells.length; q++) {
        var cv = c.cells[q];
        if (cv >= 0 && cv < counts.length) counts[cv]++;
      }
    }

    var html = [];
    html.push('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">');
    html.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
    html.push('<title>' + xmlEsc(title) + '</title>');
    html.push('<style>' + PRINT_CSS + '</style></head><body>');

    /* ---- cover ---- */
    html.push('<section class="page cover">');
    html.push('<p class="noprint">Use your browser’s Print command to print this, ' +
      'or to save it as a PDF.</p>');
    html.push('<h1>' + xmlEsc(title) + '</h1>');
    if (design.designer) html.push('<p class="sub">' + xmlEsc(design.designer) + '</p>');

    html.push('<table class="facts">');
    if (W && H) {
      html.push('<tr><td>Design size</td><td><b>' + W + ' × ' + H + ' stitches</b></td></tr>');
    }
    html.push('<tr><td>Fabric</td><td>' + xmlEsc(fabric.color) + ' ' + fabric.count + ' ct ' +
      xmlEsc(fabric.kind) + (fabric.over === 2 ? ', over 2' : '') + '</td></tr>');
    html.push('<tr><td>Strands</td><td>' + strandsDefault + '</td></tr>');
    html.push('<tr><td>Colours</td><td>' + palette.length + '</td></tr>');
    if (design.copyright) {
      html.push('<tr><td>Copyright</td><td>' + xmlEsc(design.copyright) + '</td></tr>');
    }
    html.push('</table>');

    if (W && H) {
      var tbl = sizeTable({ w: W, h: H, over: fabric.over },
        Array.isArray(opts.counts) && opts.counts.length ? opts.counts : [14, 16, 18]);
      html.push('<h2>Finished size</h2><table><tr><th>Fabric</th><th class="n">Inches</th>' +
        '<th class="n">Centimetres</th><th class="n">Fabric to buy</th></tr>');
      for (var t = 0; t < tbl.length; t++) {
        var fs = finishedSize({ w: W, h: H, count: tbl[t].count, over: fabric.over });
        html.push('<tr><td>' + tbl[t].count + ' ct</td><td class="n">' + fs.wIn + ' × ' +
          fs.hIn + '</td><td class="n">' + fs.wCm + ' × ' + fs.hCm + '</td><td class="n">' +
          fs.fabricIn.w + ' × ' + fs.fabricIn.h + ' in</td></tr>');
      }
      html.push('</table>');
    }

    if (palette.length) {
      html.push('<h2 style="margin-top:5mm">Floss</h2><table><tr><th>Symbol</th><th>Code</th>' +
        '<th>Name</th><th class="n">Stitches</th><th class="n">Skeins</th></tr>');
      for (var f = 0; f < palette.length; f++) {
        var e = palette[f];
        html.push('<tr><td><span class="sw" style="background:' +
          (color ? printHex(e) : '#ffffff') + ';color:' + inkFor(e, color) + '">' +
          xmlEsc(syms[f]) + '</span></td><td>' +
          xmlEsc((e.brand ? e.brand + ' ' : '') + e.code) + '</td><td>' +
          xmlEsc(e.name) + '</td><td class="n">' + (counts[f] || '') + '</td><td class="n">' +
          xmlEsc(skeinTextFor(counts[f], e.strands, fabric)) + '</td></tr>');
      }
      html.push('</table>');
    }
    if (!c) {
      html.push('<p class="note">This project has no chart grid yet, so there are no chart ' +
        'pages to print.</p>');
    }
    html.push('</section>');

    /* ---- chart tiles ---- */
    if (c) {
      var chart = isObj(data.chart) ? data.chart : {};
      var back = Array.isArray(chart.back) ? chart.back : [];
      var knots = Array.isArray(chart.knots) ? chart.knots : [];
      var tilesX = Math.ceil(W / sppW), tilesY = Math.ceil(H / sppH);
      /* Wave K (#19): "print what's left". The pattern's own page tiling
         and numbers (p9 on paper is p9 here), done squares hatched, parked
         threads marked, a greyed overlap from the neighbours; pages with
         nothing left can be skipped. */
      var tiles = [];
      var regionPages = (Array.isArray(data.pages) ? data.pages : []).filter(function (p) { return p && p.region; });
      if (opts.pageNumbers === 'original' && regionPages.length) {
        regionPages.forEach(function (p) {
          var lab = /(\d+)\s*$/.exec(str(p.label, ''));
          tiles.push({ x0: p.region.x, y0: p.region.y, cols: Math.min(p.region.w, W - p.region.x), rows: Math.min(p.region.h, H - p.region.y),
            label: 'p' + (lab ? lab[1] : (p.n + 1)) });
        });
      } else {
        for (var ty0 = 0; ty0 < tilesY; ty0++) {
          for (var tx0 = 0; tx0 < tilesX; tx0++) {
            tiles.push({ x0: tx0 * sppW, y0: ty0 * sppH, cols: Math.min(sppW, W - tx0 * sppW), rows: Math.min(sppH, H - ty0 * sppH), label: pageLabel(tx0, ty0) });
          }
        }
      }
      var doneB = opts.progress && isObj(data.progress) && data.progress.mode !== 'counts' ? b64ToBytes(str(data.progress.done, '')) : null;
      var ov = clampInt(opts.overlap, 0, 5, 0);
      var parkList = opts.parking ? (Array.isArray(data.parking) ? data.parking : []) : [];
      for (var tt = 0; tt < tiles.length; tt++) {
        var T = tiles[tt];
        var x0 = T.x0, y0 = T.y0, cols = T.cols, rows = T.rows, label = T.label, core = null;
        if (cols <= 0 || rows <= 0) continue;
        if (doneB && opts.remaining) {
          var anyLeft = false;
          for (var ry = y0; ry < y0 + rows && !anyLeft; ry++) {
            for (var rx = x0; rx < x0 + cols; rx++) {
              var ri = ry * W + rx;
              if (c.cells[ri] >= 0 && !(((doneB[ri >> 3] || 0) >> (ri & 7)) & 1)) { anyLeft = true; break; }
            }
          }
          if (!anyLeft) continue;
        }
        if (ov) {
          core = { x0: x0, y0: y0, x1: x0 + cols - 1, y1: y0 + rows - 1 };
          var nx0 = Math.max(0, x0 - ov), ny0 = Math.max(0, y0 - ov);
          cols = Math.min(W, x0 + cols + ov) - nx0; rows = Math.min(H, y0 + rows + ov) - ny0;
          x0 = nx0; y0 = ny0;
        }
        {
          var used = {}, anyUsed = false;
          for (var uy = 0; uy < rows; uy++) {
            for (var ux = 0; ux < cols; ux++) {
              var uv = c.cells[(y0 + uy) * W + (x0 + ux)];
              if (uv >= 0) { used[uv] = 1; anyUsed = true; }
            }
          }
          html.push('<section class="page chart-page">');
          html.push('<div class="pagehead"><span class="tag">' + xmlEsc(label) + '</span>' +
            '<span>' + xmlEsc(title) + ' · columns ' + (x0 + 1) + '–' + (x0 + cols) +
            ', rows ' + (y0 + 1) + '–' + (y0 + rows) + '</span></div>');
          html.push(tileSvg({
            cells: c.cells, W: W, x0: x0, y0: y0, cols: cols, rows: rows,
            color: color, syms: syms, palette: palette, back: back, knots: knots,
            designW: W, designH: H, label: label,
            done: doneB, core: core, parking: parkList
          }));
          if (withKey && anyUsed) html.push(keyStrip(palette, syms, used, color));
          html.push('</section>');
        }
      }
    }

    html.push('</body></html>');
    return html.join('');
  }

  /* ================================================================== *
   * 10b. PDF grid extraction (B3.4) — the "Try to read the grid" beta
   *
   * What the real charts turned out to look like (KG-Chart LE, 2026-09-16):
   * the symbol glyphs are NOT one text item per stitch. Only a handful of
   * colours are drawn with a real font; every other cell is a vector path.
   * What IS one item per stitch is the *coloured square*: each stitch is four
   * quarter-squares (`re` + `f`) filled with the colour's exact RGB. So this
   * reads the page's operator list, keeps the axis-aligned rectangles of the
   * dominant size, fits a lattice to them, merges the 2x2 quarter cells, and
   * uses the per-colour stitch counts in the key to name the colours. Text
   * glyphs are still collected and used when a generator does put one glyph
   * per stitch (and to match by symbol when the key printed one).
   * ================================================================== */

  /* pdf.js operator numbers; overridden from window.pdfjsLib.OPS when present. */
  var PDF_OPS_FALLBACK = {
    save: 10, restore: 11, transform: 12, rectangle: 19, constructPath: 91,
    setFillRGBColor: 59, setFillGray: 57, setFillCMYKColor: 61,
    /* wave K: what a path is painted with, and its segment codes */
    fill: 22, eoFill: 23, fillStroke: 24, eoFillStroke: 25, closeFillStroke: 26,
    closeEOFillStroke: 27, stroke: 20, closeStroke: 21,
    moveTo: 13, lineTo: 14, curveTo: 15, curveTo2: 16, curveTo3: 17, closePath: 18,
    setLineWidth: 2, setStrokeRGBColor: 58, setStrokeGray: 56, setStrokeCMYKColor: 60
  };

  function pdfOps() {
    var O = window.pdfjsLib && window.pdfjsLib.OPS;
    if (!O || typeof O.constructPath !== 'number') return PDF_OPS_FALLBACK;
    var out = {};
    for (var k in PDF_OPS_FALLBACK) {
      if (PDF_OPS_FALLBACK.hasOwnProperty(k)) out[k] = typeof O[k] === 'number' ? O[k] : PDF_OPS_FALLBACK[k];
    }
    return out;
  }

  /* ---- wave K: the symbol drawn in a cell, as a signature -------------- *
   * KG-Chart draws each cell's symbol as filled paths over the coloured
   * square (white on dark squares, near-black on light ones). Two key
   * colours that the PDF prints in ONE RGB (pacman: DMC 349 and DMC 3843 are
   * both 5b5b5b on the symbol pages) are still told apart by that symbol, so
   * the reader keeps, per cell, an 8 x 8 coverage mask of whatever is drawn
   * inside it. The mask ignores the symbol's own colour (it flips with the
   * square's lightness) and is scale-free, so a key swatch's symbol and a
   * chart cell's symbol give the same mask.
   * ------------------------------------------------------------------- */
  /* 16 samples a side: KG's thinnest bar is ~0.084 of a cell, so a coarser
     grid can fall between its edges and lose the symbol (measured: at 8 x 8
     pacman's DMC 3843 "-" vanished in some cells). */
  var SIG_N = 16;
  var SIG_NEAR = 3;       // maskNear: the same symbol rasterised a hair apart
  var SIG_FAR = 16;       // maskNear: further than this is not the legend's symbol

  /** Polygons (flat [x,y,...] in page space) of one constructPath. */
  function pathPolys(codes, co, ctm, OPS) {
    var polys = [], cur = null, j = 0;
    function pt(x, y) {
      cur.push(x * ctm[0] + y * ctm[2] + ctm[4], x * ctm[1] + y * ctm[3] + ctm[5]);
    }
    for (var q = 0; q < codes.length; q++) {
      var c = codes[q];
      if (c === OPS.rectangle) {
        var rx = co[j], ry = co[j + 1], rw = co[j + 2], rh = co[j + 3];
        j += 4;
        cur = [];
        pt(rx, ry); pt(rx + rw, ry); pt(rx + rw, ry + rh); pt(rx, ry + rh);
        polys.push(cur); cur = null;
      } else if (c === OPS.moveTo) {
        cur = []; polys.push(cur); pt(co[j], co[j + 1]); j += 2;
      } else if (c === OPS.lineTo) {
        if (!cur) { cur = []; polys.push(cur); }
        pt(co[j], co[j + 1]); j += 2;
      } else if (c === OPS.curveTo) {
        if (!cur) { cur = []; polys.push(cur); }
        pt(co[j], co[j + 1]); pt(co[j + 2], co[j + 3]); pt(co[j + 4], co[j + 5]); j += 6;
      } else if (c === OPS.curveTo2 || c === OPS.curveTo3) {
        if (!cur) { cur = []; polys.push(cur); }
        pt(co[j], co[j + 1]); pt(co[j + 2], co[j + 3]); j += 4;
      } else if (c === OPS.closePath) {
        cur = null;
      }
    }
    var out = [];
    for (var p = 0; p < polys.length; p++) if (polys[p].length >= 6) out.push(polys[p]);
    return out;
  }

  /** A collected shape's polygons (an axis-aligned rect builds them on demand). */
  function shapePolys(s) {
    if (!s.polys) s.polys = [[s.x0, s.y0, s.x1, s.y0, s.x1, s.y1, s.x0, s.y1]];
    return s.polys;
  }

  function polysBox(polys) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var p = 0; p < polys.length; p++) {
      var a = polys[p];
      for (var k = 0; k < a.length; k += 2) {
        if (a[k] < x0) x0 = a[k];
        if (a[k] > x1) x1 = a[k];
        if (a[k + 1] < y0) y0 = a[k + 1];
        if (a[k + 1] > y1) y1 = a[k + 1];
      }
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  /** Even-odd point-in-polygon over one shape's sub-polygons. */
  function insideShape(polys, x, y) {
    var inside = false;
    for (var p = 0; p < polys.length; p++) {
      var a = polys[p], n = a.length;
      for (var i = 0, k = n - 2; i < n; k = i, i += 2) {
        var yi = a[i + 1], yk = a[k + 1];
        if ((yi > y) !== (yk > y) && x < (a[k] - a[i]) * (y - yi) / (yk - yi) + a[i]) inside = !inside;
      }
    }
    return inside;
  }

  /**
   * shapeMask(shapes, box) -> 16 hex chars (64 bits, row-major from the TOP
   * of the box) or '' when nothing covers a sample. `box` is in page space
   * (y up), `shapes` an array of polygon lists.
   */
  function shapeMask(shapes, box) {
    var bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    if (!(bw > 0) || !(bh > 0) || !shapes.length) return '';
    var bits = [], any = false;
    for (var r = 0; r < SIG_N; r++) {
      var y = box.y1 - (r + 0.5) * bh / SIG_N;
      var byte = 0;
      for (var c = 0; c < SIG_N; c++) {
        var x = box.x0 + (c + 0.5) * bw / SIG_N;
        for (var s = 0; s < shapes.length; s++) {
          if (insideShape(shapes[s], x, y)) { byte |= (1 << c); any = true; break; }
        }
      }
      bits.push(byte);
    }
    if (!any) return '';
    var hex = '', W = SIG_N / 4;
    for (var b = 0; b < bits.length; b++) {
      var hs = bits[b].toString(16);
      while (hs.length < W) hs = '0' + hs;
      hex += hs;
    }
    return hex;
  }

  function maskRows(m) {
    var W = SIG_N / 4, rows = [];
    for (var i = 0; i < SIG_N; i++) rows.push(m ? parseInt(m.substr(i * W, W), 16) || 0 : 0);
    return rows;
  }
  function popc(x) { var d = 0; while (x) { d += x & 1; x >>>= 1; } return d; }

  /**
   * maskNear(a, b) -> inked samples of either mask that are more than one
   * sample away from any inked sample of the other. A thin bar rasterised
   * one column over costs nothing; a missing or extra stroke costs its length.
   */
  function maskNear(a, b) {
    if (a === b) return 0;
    var ra = maskRows(a), rb = maskRows(b), full = (1 << SIG_N) - 1;
    function dil(rows, i) {
      var v = 0;
      for (var d = -1; d <= 1; d++) {
        var r = rows[i + d];
        if (r === undefined) continue;
        v |= r | (r << 1) | (r >>> 1);
      }
      return v & full;
    }
    var n = 0;
    for (var i = 0; i < SIG_N; i++) {
      n += popc(ra[i] & ~dil(rb, i) & full) + popc(rb[i] & ~dil(ra, i) & full);
    }
    return n;
  }

  /** Hamming distance between two masks ('' is the empty mask). */
  function maskDist(a, b) {
    if (a === b) return 0;
    var d = 0, W = SIG_N / 4;
    for (var i = 0; i < SIG_N; i++) {
      var x = (a ? parseInt(a.substr(i * W, W), 16) || 0 : 0) ^ (b ? parseInt(b.substr(i * W, W), 16) || 0 : 0);
      while (x) { d += x & 1; x >>= 1; }
    }
    return d;
  }

  function mulCtm(a, b) {
    return [
      a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
      a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
      a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]
    ];
  }

  /**
   * combFit(values, hint) -> { pitch, origin, strength } | null
   * The autocorrelation the spec asks for, done as a comb (Fourier) fit: the
   * candidate pitch whose unit phasor sum over all positions is longest is the
   * lattice spacing, and the sum's phase is the lattice origin. Robust against
   * the 20-30% of marks that are not on the lattice at all.
   */
  function combFit(vals, hint) {
    var i, k, bins = {};
    for (i = 0; i < vals.length; i++) {
      k = Math.round(vals[i] * 20);
      bins[k] = (bins[k] || 0) + 1;
    }
    var keys = Object.keys(bins);
    if (keys.length < 4 || !(hint > 0.2)) return null;
    var pos = new Float64Array(keys.length), wt = new Float64Array(keys.length);
    var total = 0, lo = Infinity;
    for (i = 0; i < keys.length; i++) {
      pos[i] = parseInt(keys[i], 10) / 20;
      wt[i] = bins[keys[i]];
      total += wt[i];
      if (pos[i] < lo) lo = pos[i];
    }
    if (!total) return null;
    var best = null;
    for (var s = -160; s <= 160; s++) {
      var p = hint * (1 + s * 0.002);
      if (!(p > 0.2)) continue;
      var re = 0, im = 0;
      for (i = 0; i < pos.length; i++) {
        var a = 2 * Math.PI * pos[i] / p;
        re += wt[i] * Math.cos(a);
        im += wt[i] * Math.sin(a);
      }
      var mag = Math.sqrt(re * re + im * im) / total;
      if (!best || mag > best.mag) best = { mag: mag, p: p, ph: Math.atan2(im, re) };
    }
    if (!best) return null;
    var origin = best.ph / (2 * Math.PI) * best.p;
    origin += Math.round((lo - origin) / best.p) * best.p;
    return { pitch: best.p, origin: origin, strength: best.mag };
  }

  /** Lattice origin for a pitch we already know (used for narrow edge tiles). */
  function phaseFit(vals, pitch) {
    if (!(pitch > 0.2) || !vals || !vals.length) return null;
    var re = 0, im = 0, lo = Infinity, i;
    for (i = 0; i < vals.length; i++) {
      var a = 2 * Math.PI * vals[i] / pitch;
      re += Math.cos(a); im += Math.sin(a);
      if (vals[i] < lo) lo = vals[i];
    }
    var mag = Math.sqrt(re * re + im * im) / vals.length;
    var origin = Math.atan2(im, re) / (2 * Math.PI) * pitch;
    origin += Math.round((lo - origin) / pitch) * pitch;
    return { pitch: pitch, origin: origin, strength: mag };
  }

  function modeKey(map) {
    var best = null, bn = 0, ks = Object.keys(map);
    for (var i = 0; i < ks.length; i++) {
      if (map[ks[i]] > bn) { bn = map[ks[i]]; best = parseFloat(ks[i]); }
    }
    return { value: best, votes: bn };
  }

  function hex6(r, g, b) {
    var v = ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
    var s = v.toString(16);
    while (s.length < 6) s = '0' + s;
    return s;
  }

  /** Every axis-aligned rectangle on a page, in page space, with its fill. */
  function colourOf(f, a, OPS) {
    if (f === OPS.setFillRGBColor || f === OPS.setStrokeRGBColor) return hex6(a[0], a[1], a[2]);
    if (f === OPS.setFillGray || f === OPS.setStrokeGray) {
      var g = Math.round(num(a[0], 0) * 255);
      return hex6(g, g, g);
    }
    var cc = num(a[0], 0), mm = num(a[1], 0), yy = num(a[2], 0), kk = num(a[3], 0);
    return hex6(Math.round(255 * (1 - Math.min(1, cc + kk))),
      Math.round(255 * (1 - Math.min(1, mm + kk))),
      Math.round(255 * (1 - Math.min(1, yy + kk))));
  }

  function collectRects(ops, OPS, wantSegs) {
    var ctm = [1, 0, 0, 1, 0, 0], stack = [], fill = '000000';
    var rects = [], sizes = {};
    /* wave K: every filled shape (for the cell symbols and the key swatches)
       and every stroked straight segment (for backstitch), in page space */
    var shapes = [], segs = [], stroke = '000000', lw = 1, lwStack = [];
    var FILLS = {}, STROKES = {};
    FILLS[OPS.fill] = FILLS[OPS.eoFill] = FILLS[OPS.fillStroke] = FILLS[OPS.eoFillStroke] = 1;
    FILLS[OPS.closeFillStroke] = FILLS[OPS.closeEOFillStroke] = 1;
    STROKES[OPS.stroke] = STROKES[OPS.closeStroke] = STROKES[OPS.fillStroke] = STROKES[OPS.eoFillStroke] = 1;
    STROKES[OPS.closeFillStroke] = STROKES[OPS.closeEOFillStroke] = 1;
    var fns = ops.fnArray, args = ops.argsArray;
    for (var i = 0; i < fns.length; i++) {
      var f = fns[i], a = args[i];
      if (f === OPS.constructPath && a && a[0] && a[1]) {
        var paint = fns[i + 1];
        if (FILLS[paint] && a[0].length === 1 && a[0][0] === OPS.rectangle && !ctm[1] && !ctm[2]) {
          /* the common case (every lattice square): no polygon until one is
             needed (rectPolys) */
          var qx0 = a[1][0] * ctm[0] + a[1][1] * ctm[2] + ctm[4];
          var qy0 = a[1][0] * ctm[1] + a[1][1] * ctm[3] + ctm[5];
          var qx1 = qx0 + a[1][2] * ctm[0], qy1 = qy0 + a[1][3] * ctm[3];
          shapes.push({ polys: null, x0: Math.min(qx0, qx1), y0: Math.min(qy0, qy1),
            x1: Math.max(qx0, qx1), y1: Math.max(qy0, qy1), hex: fill, rect: true, curve: false });
        } else if (FILLS[paint]) {
          var sp = pathPolys(a[0], a[1], ctm, OPS);
          if (sp.length) {
            var sb = polysBox(sp);
            var curve = false;
            for (var cq = 0; cq < a[0].length; cq++) {
              if (a[0][cq] === OPS.curveTo || a[0][cq] === OPS.curveTo2 || a[0][cq] === OPS.curveTo3) { curve = true; break; }
            }
            shapes.push({ polys: sp, x0: sb.x0, y0: sb.y0, x1: sb.x1, y1: sb.y1, hex: fill,
              rect: a[0].length === 1 && a[0][0] === OPS.rectangle, curve: curve });
          }
        }
        if (wantSegs && STROKES[paint]) {
          var lp = pathPolys(a[0], a[1], ctm, OPS);
          var scale = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])) || 1;
          for (var li = 0; li < lp.length; li++) {
            var L = lp[li];
            for (var lk = 0; lk + 3 < L.length; lk += 2) {
              segs.push({ x1: L[lk], y1: L[lk + 1], x2: L[lk + 2], y2: L[lk + 3], hex: stroke, width: lw * scale });
            }
          }
        }
      }
      if (f === OPS.setStrokeRGBColor || f === OPS.setStrokeGray || f === OPS.setStrokeCMYKColor) {
        stroke = colourOf(f, a, OPS);
      } else if (f === OPS.setLineWidth) {
        lw = num(a[0], 1);
      }
      if (f === OPS.save) { stack.push(ctm.slice()); lwStack.push(lw); }
      else if (f === OPS.restore) { if (stack.length) ctm = stack.pop(); if (lwStack.length) lw = lwStack.pop(); }
      else if (f === OPS.transform) { ctm = mulCtm([a[0], a[1], a[2], a[3], a[4], a[5]], ctm); }
      else if (f === OPS.setFillRGBColor) { fill = hex6(a[0], a[1], a[2]); }
      else if (f === OPS.setFillGray) {
        var gv = Math.round(num(a[0], 0) * 255);
        fill = hex6(gv, gv, gv);
      } else if (f === OPS.setFillCMYKColor) {
        var cc = num(a[0], 0), mm = num(a[1], 0), yy = num(a[2], 0), kk = num(a[3], 0);
        fill = hex6(Math.round(255 * (1 - Math.min(1, cc + kk))),
          Math.round(255 * (1 - Math.min(1, mm + kk))),
          Math.round(255 * (1 - Math.min(1, yy + kk))));
      } else if (f === OPS.constructPath) {
        var codes = a[0], co = a[1];
        if (!codes || !co || codes.length * 4 !== co.length) continue;
        var allRect = true;
        for (var q = 0; q < codes.length; q++) {
          if (codes[q] !== OPS.rectangle) { allRect = false; break; }
        }
        if (!allRect) continue;
        for (var r = 0; r < codes.length; r++) {
          var bx = co[r * 4], by = co[r * 4 + 1], bw = co[r * 4 + 2], bh = co[r * 4 + 3];
          var W = bw * ctm[0], H = bh * ctm[3];
          if (!(W > 0.05) || !(H > 0.05)) continue;
          rects.push({
            x: bx * ctm[0] + by * ctm[2] + ctm[4],
            y: bx * ctm[1] + by * ctm[3] + ctm[5],
            w: W, h: H, id: fill
          });
          var sk = Math.round(W * 10) / 10;
          sizes[sk] = (sizes[sk] || 0) + 1;
        }
      }
    }
    return { rects: rects, sizes: sizes, shapes: shapes, segs: segs };
  }

  /** Single-character text items on a page, keyed by font + glyph. */
  function collectGlyphs(tc) {
    var out = [], nums = [];
    var items = (tc && tc.items) || [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var s = str(it.str, '');
      if (!s || !it.transform) continue;
      var trimmed = s.replace(/\s+/g, '');
      if (!trimmed) continue;
      var x = num(it.transform[4], 0), y = num(it.transform[5], 0);
      if (/^\d{1,4}$/.test(trimmed)) { nums.push({ v: parseInt(trimmed, 10), x: x, y: y }); continue; }
      if (trimmed.length !== 1) continue;
      out.push({ x: x, y: y, w: 1, h: 1, id: str(it.fontName, 'f') + '\u0001' + trimmed });
    }
    return { marks: out, nums: nums };
  }

  /**
   * latticeOf(marks, hint) -> tile | null
   * Fits the lattice, snaps the marks, merges the KxK sub-cells a generator
   * may use for quarter stitches, and reports how well the marks snapped.
   */
  function latticeOf(marks, hint, forced) {
    var minMarks = forced ? 12 : 80;
    if (!marks || marks.length < minMarks) return null;
    var i, xs = [], ys = [];
    for (i = 0; i < marks.length; i++) { xs.push(marks[i].x); ys.push(marks[i].y); }
    var fx, fy;
    if (forced) {
      /* A narrow edge tile has too few columns to fit a pitch to. Reuse the
         pitch the rest of the chart agreed on and only solve for the phase. */
      fx = phaseFit(xs, forced.pitchX) || combFit(xs, hint);
      fy = phaseFit(ys, forced.pitchY) || combFit(ys, hint);
    } else {
      fx = combFit(xs, hint);
      fy = combFit(ys, hint);
    }
    if (!fx || !fy) return null;

    var minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    var snap = [], good = 0;
    for (i = 0; i < marks.length; i++) {
      var ax = (marks[i].x - fx.origin) / fx.pitch;
      var by = (marks[i].y - fy.origin) / fy.pitch;
      var A = Math.round(ax), B = Math.round(by);
      if (Math.abs(ax - A) > 0.2 || Math.abs(by - B) > 0.2) continue;
      good++;
      snap.push([A, B, marks[i].id]);
      if (A < minA) minA = A;
      if (A > maxA) maxA = A;
      if (B < minB) minB = B;
      if (B > maxB) maxB = B;
    }
    var snapPct = good / marks.length;
    if (!snap.length || snapPct < 0.8) return null;

    var cols = maxA - minA + 1, rows = maxB - minB + 1;
    var minSide = forced ? 1 : 4;
    if (cols < minSide || rows < minSide || cols > 4000 || rows > 4000) return null;

    var sub = [];
    for (i = 0; i < cols * rows; i++) sub.push(null);
    for (i = 0; i < snap.length; i++) {
      /* PDF y grows upwards; chart rows grow downwards. */
      sub[(rows - 1 - (snap[i][1] - minB)) * cols + (snap[i][0] - minA)] = snap[i][2];
    }

    /* KG-Chart draws each stitch as 2x2 quarter squares (so quarter stitches
       can differ). Work out the factor, smallest first: a k that is a multiple
       of the real one is uniform too. */
    function uniformity(k, off) {
      var tot = 0, same = 0;
      for (var y = off; y + k <= rows; y += k) {
        for (var x = off; x + k <= cols; x += k) {
          var v = sub[y * cols + x];
          if (v === null) continue;
          tot++;
          var ok = true;
          for (var dy = 0; dy < k && ok; dy++) {
            for (var dx = 0; dx < k; dx++) {
              if (sub[(y + dy) * cols + x + dx] !== v) { ok = false; break; }
            }
          }
          if (ok) same++;
        }
      }
      return tot > 20 ? same / tot : -1;
    }

    /* A chart of big solid blocks is uniform at any k, so an aligned k only
       counts when shifting the window by one sub-cell makes it visibly worse. */
    var kOk = {};
    for (var k = 2; k <= 3; k++) {
      var u0 = uniformity(k, 0);
      if (u0 < 0.9) continue;
      var u1 = uniformity(k, 1);
      if (u1 < 0 || u0 - u1 >= 0.15) kOk[k] = true;
    }

    return {
      sub: sub, cols: cols, rows: rows, kOk: kOk, snapPct: snapPct, forced: !!forced,
      originX: fx.origin + minA * fx.pitch, originY: fy.origin + minB * fy.pitch,
      x0: fx.origin + minA * fx.pitch, x1: fx.origin + maxA * fx.pitch,
      y0: fy.origin + minB * fy.pitch, y1: fy.origin + maxB * fy.pitch,
      fx: fx, fy: fy, minA: minA, minB: minB, maxA: maxA, maxB: maxB,
      strength: Math.min(fx.strength, fy.strength)
    };
  }

  /**
   * How many stitches one ruler step covers, read straight off the margin
   * numbers: two labels 10 apart in value are 10 cells apart on the page. Used
   * to pin down the sub-cell factor K without guessing.
   */
  function rulerK(lat, nums) {
    var cols = [], rows = [], i;
    for (i = 0; i < nums.length; i++) {
      var n = nums[i];
      if (n.v < 1 || n.v > 20000) continue;
      if (n.x < lat.x0 - 2 || n.x > lat.x1 + lat.fx.pitch * 4 + 2) {
        if (n.y >= lat.y0 - lat.fy.pitch * 4 && n.y <= lat.y1 + lat.fy.pitch * 4) rows.push(n);
      } else if (n.y < lat.y0 - 2 || n.y > lat.y1 + lat.fy.pitch * 4 + 2) {
        cols.push(n);
      }
    }
    function stepOf(list, pitch, coord) {
      var seen = {}, pts = [], j;
      for (j = 0; j < list.length; j++) {
        var key = list[j].v;
        if (seen[key]) continue;
        seen[key] = 1;
        pts.push({ v: list[j].v, p: list[j][coord] });
      }
      if (pts.length < 2) return 0;
      pts.sort(function (a, b) { return a.v - b.v; });
      var best = 0, bn = 0, tally = {};
      for (j = 1; j < pts.length; j++) {
        var dv = pts[j].v - pts[j - 1].v;
        if (dv < 5) continue;
        var kk = Math.round(Math.abs(pts[j].p - pts[j - 1].p) / dv / pitch);
        if (kk < 1 || kk > 4) continue;
        tally[kk] = (tally[kk] || 0) + 1;
        if (tally[kk] > bn) { bn = tally[kk]; best = kk; }
      }
      return best;
    }
    return stepOf(cols, lat.fx.pitch, 'x') || stepOf(rows, lat.fy.pitch, 'y') || 0;
  }

  /** Collapse a lattice's KxK sub-cells into the stitch grid. */
  function mergeTile(lat, K) {
    if (!lat) return null;
    K = clampInt(K, 1, 4, 1);
    var cols = lat.cols, rows = lat.rows, sub = lat.sub;
    var gc = Math.ceil(cols / K), gr = Math.ceil(rows / K);
    if (!lat.forced && (gc < 10 || gr < 10)) return null;
    if (gc < 1 || gr < 1) return null;
    var grid = [], mixed = 0;
    for (var gy = 0; gy < gr; gy++) {
      for (var gx = 0; gx < gc; gx++) {
        var v0 = sub[(gy * K) * cols + (gx * K)];
        grid.push(v0);
        /* Wave K: a square whose sub-squares differ is a fractional stitch
           (KG-Chart's quarters); counted so the read can say so */
        if (K > 1) {
          var diff = false;
          for (var dy = 0; dy < K && !diff; dy++) {
            for (var dx = 0; dx < K; dx++) {
              var yy = gy * K + dy, xx = gx * K + dx;
              if (yy < rows && xx < cols && sub[yy * cols + xx] !== v0) { diff = true; break; }
            }
          }
          if (diff) mixed++;
        }
      }
    }
    lat.mixed = mixed;
    lat.K = K;
    lat.gc = gc;
    lat.gr = gr;
    lat.grid = grid;
    lat.cellW = lat.fx.pitch * K;
    lat.cellH = lat.fy.pitch * K;
    lat.sub = null;
    return lat;
  }

  /** Place a tile in whole-design coordinates from its ruler numbers. */
  function placeTile(tile, nums) {
    var rowVotes = {}, colVotes = {}, i;
    for (i = 0; i < nums.length; i++) {
      var n = nums[i];
      if (n.v < 1 || n.v > 20000) continue;
      if (n.x < tile.x0 - 2 || n.x > tile.x1 + tile.cellW + 2) {
        /* left or right margin: a row label */
        if (n.y < tile.y0 - tile.cellH || n.y > tile.y1 + tile.cellH * 2) continue;
        var b = Math.round((n.y - tile.fy.origin) / tile.fy.pitch) - tile.minB;
        var cellRow = tile.gr - 1 - Math.floor(b / tile.K);
        var ro = n.v - cellRow;
        if (ro >= 1) rowVotes[ro] = (rowVotes[ro] || 0) + 1;
      } else if (n.y < tile.y0 - 2 || n.y > tile.y1 + tile.cellH + 2) {
        /* above or below: a column label */
        var a = Math.round((n.x - tile.fx.origin) / tile.fx.pitch) - tile.minA;
        var cellCol = Math.floor(a / tile.K);
        var co = n.v - cellCol;
        if (co >= 1) colVotes[co] = (colVotes[co] || 0) + 1;
      }
    }
    var rm = modeKey(rowVotes), cm = modeKey(colVotes);
    return {
      col: cm.value === null ? null : cm.value - 1,
      row: rm.value === null ? null : rm.value - 1,
      colVotes: cm.votes, rowVotes: rm.votes
    };
  }

  /** The sub-cell factor: the ruler numbers decide it when they can. */
  function pickK(lat, nums) {
    var k = rulerK(lat, nums);
    if (k >= 1) return k;
    if (lat.kOk[2]) return 2;
    if (lat.kOk[3]) return 3;
    return 1;
  }

  /** A page's box in PDF space and its /Rotate, for tileRegion. */
  function pageBoxOf(page) {
    var v = page && page.view;
    if (!v || v.length !== 4) return null;
    return { view: [num(v[0], 0), num(v[1], 0), num(v[2], 0), num(v[3], 0)], rotate: clampInt(page.rotate, -720, 720, 0) };
  }

  /**
   * tileRegion(tile) -> pages[i].region (see normalizeRegion)
   * The stitches a placed tile covers and where they sit on its page. PDF y
   * grows upwards, so the chart's top edge is the top sub-row's lower edge
   * plus one sub-cell. A rotated page keeps its cell range but no fractions
   * (the rendered image is turned, and the stitcher can still pan to it).
   */
  function tileRegion(t) {
    if (!t || !t.place) return null;
    var out = { x: t.place.col, y: t.place.row, w: t.gc, h: t.gr, fx: null, fy: null, fw: null, fh: null };
    var b = t.pageBox;
    if (b && !(b.rotate % 360) && t.fx && t.fy) {
      var pw = b.view[2] - b.view[0], ph = b.view[3] - b.view[1];
      if (pw > 0 && ph > 0) {
        out.fx = (t.x0 - b.view[0]) / pw;
        out.fw = t.cols * t.fx.pitch / pw;
        out.fy = (b.view[3] - (t.y1 + t.fy.pitch)) / ph;
        out.fh = t.rows * t.fy.pitch / ph;
      }
    }
    return normalizeRegion(out);
  }

  /**
   * One page -> { tile } when it reads as a chart page, or
   * { pending: marks, hint, nums } when it looks like one but was too narrow
   * to fit a lattice to on its own, or null.
   */
  function extractPage(page, OPS, wantSegs) {
    return page.getOperatorList().then(function (ops) {
      var col = collectRects(ops, OPS, wantSegs);
      var dom = modeKey(col.sizes);
      var lat = null, source = 'rects', keep = null;
      if (dom.value !== null && dom.votes >= 40) {
        keep = [];
        var lim = dom.value * 0.25;
        for (var i = 0; i < col.rects.length; i++) {
          var r = col.rects[i];
          if (Math.abs(r.w - dom.value) <= lim && Math.abs(r.h - dom.value) <= lim) keep.push(r);
        }
        if (keep.length >= 200) lat = latticeOf(keep, dom.value);
      }
      return page.getTextContent().then(function (tc) {
        var g = collectGlyphs(tc);
        var hint = dom.value;
        if (!lat && g.marks.length >= 200) {
          /* a generator that really does put one glyph per stitch */
          var gx = [], gi;
          for (gi = 1; gi < g.marks.length; gi++) gx.push(Math.abs(g.marks[gi].x - g.marks[gi - 1].x));
          gx.sort(function (a, b) { return a - b; });
          var hintG = 0;
          for (gi = 0; gi < gx.length; gi++) { if (gx[gi] > 1) { hintG = gx[gi]; break; } }
          if (hintG > 0) {
            lat = latticeOf(g.marks, hintG);
            if (lat) { source = 'glyphs'; hint = hintG; }
            else if (!keep || keep.length < 40) { keep = g.marks; hint = hintG; }
          }
        }
        if (page.cleanup) { try { page.cleanup(); } catch (e) { /* ignore */ } }
        var tile = lat ? mergeTile(lat, pickK(lat, g.nums)) : null;
        var box = pageBoxOf(page);
        if (tile) {
          tile.source = source;
          tile.place = placeTile(tile, g.nums);
          tile.pageBox = box;
          tile.sig = tileSigs(tile, col.shapes, g.marks);
          tile.segs = col.segs.length <= 50000 ? col.segs : [];
          tile.dots = tileDots(tile, col.shapes);
          return { tile: tile };
        }
        if (keep && keep.length >= 40 && keep.length <= 20000 && hint > 0) {
          return { pending: keep, hint: hint, nums: g.nums, pageBox: box, shapes: col.shapes, marks: g.marks, segs: col.segs };
        }
        var leg = legendOf(col.shapes);
        if (leg) return { legend: leg };
        return null;
      });
    }, function () { return null; });
  }

  /* ---- wave K: tile geometry, cell symbols, knots, the key's swatches ---- */

  /** A page-space point -> fractional (c, r) in the tile's cells, r from the top. */
  function tileCellOf(t, x, y) {
    var left = t.fx.origin + t.minA * t.fx.pitch;
    var top = t.fy.origin + (t.maxB + 1) * t.fy.pitch;
    return { c: (x - left) / t.cellW, r: (top - y) / t.cellH };
  }

  /** The page-space box of tile cell (col, row). */
  function tileCellBox(t, col, row) {
    var left = t.fx.origin + t.minA * t.fx.pitch;
    var top = t.fy.origin + (t.maxB + 1) * t.fy.pitch;
    return { x0: left + col * t.cellW, x1: left + (col + 1) * t.cellW,
      y1: top - row * t.cellH, y0: top - (row + 1) * t.cellH };
  }

  /** A filled shape that is one of the lattice's own squares (or quarters). */
  function isLatticeSquare(t, s) {
    if (!s.rect) return false;
    var w = s.x1 - s.x0, h = s.y1 - s.y0;
    return (Math.abs(w - t.fx.pitch) <= t.fx.pitch * 0.25 && Math.abs(h - t.fy.pitch) <= t.fy.pitch * 0.25) ||
      (Math.abs(w - t.cellW) <= t.cellW * 0.25 && Math.abs(h - t.cellH) <= t.cellH * 0.25);
  }

  /** A small round blob sitting on a lattice vertex: a French knot or a bead. */
  function isVertexDot(t, s) {
    if (!s.curve) return false;
    var w = s.x1 - s.x0, h = s.y1 - s.y0;
    if (w > t.cellW * 0.75 || h > t.cellH * 0.75) return false;
    var p = tileCellOf(t, (s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2);
    return Math.abs(p.c * 2 - Math.round(p.c * 2)) < 0.3 && Math.abs(p.r * 2 - Math.round(p.r * 2)) < 0.3 &&
      (Math.abs(p.c - Math.round(p.c)) < 0.15 || Math.abs(p.r - Math.round(p.r)) < 0.15);
  }

  /**
   * tileSigs(tile, shapes, textMarks) -> string[gc * gr]
   * Per cell, the 8 x 8 mask of the symbol drawn inside it ('' for none),
   * plus '|' + font glyph id when a text glyph sits in the cell.
   */
  function tileSigs(t, shapes, textMarks) {
    var n = t.gc * t.gr, sig = new Array(n), per = {}, i, k;
    t.sigPolys = t.sigPolys || {};
    for (i = 0; i < n; i++) sig[i] = '';
    for (i = 0; i < shapes.length; i++) {
      var s = shapes[i];
      if (isLatticeSquare(t, s)) continue;
      if (s.x1 - s.x0 > t.cellW * 1.1 || s.y1 - s.y0 > t.cellH * 1.1) continue;
      if (isVertexDot(t, s)) continue;
      var p = tileCellOf(t, (s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2);
      var col = Math.floor(p.c), row = Math.floor(p.r);
      if (col < 0 || row < 0 || col >= t.gc || row >= t.gr) continue;
      var idx = row * t.gc + col;
      (per[idx] = per[idx] || []).push(shapePolys(s));
    }
    var cache = {}, keys = Object.keys(per);
    for (k = 0; k < keys.length; k++) {
      var ci = +keys[k], cr = Math.floor(ci / t.gc), cc = ci - cr * t.gc;
      var box = tileCellBox(t, cc, cr), list = per[ci];
      /* the same symbol at the same place in its cell gives the same key */
      var qk = [];
      for (var a = 0; a < list.length; a++) {
        for (var b = 0; b < list[a].length; b++) {
          var poly = list[a][b], q = [];
          for (var v = 0; v < poly.length; v += 2) {
            q.push(Math.round((poly[v] - box.x0) / t.cellW * 32), Math.round((poly[v + 1] - box.y0) / t.cellH * 32));
          }
          qk.push(q.join(','));
        }
      }
      var key = qk.sort().join(';');
      if (!cache.hasOwnProperty(key)) {
        cache[key] = shapeMask(list, box);
        /* one drawing of each symbol, in a unit box (y down), for R5 */
        if (cache[key] && !t.sigPolys[cache[key]]) t.sigPolys[cache[key]] = unitPolys(list, box);
      }
      sig[ci] = cache[key];
    }
    if (t.source !== 'glyphs' && textMarks && textMarks.length) {
      for (i = 0; i < textMarks.length; i++) {
        var m = textMarks[i];
        var tp = tileCellOf(t, m.x + t.cellW * 0.3, m.y + t.cellH * 0.3);
        var tc = Math.floor(tp.c), tr = Math.floor(tp.r);
        if (tc < 0 || tr < 0 || tc >= t.gc || tr >= t.gr) continue;
        sig[tr * t.gc + tc] += '|' + m.id;
      }
    }
    return sig;
  }

  /** Knots / beads on a tile, in tile cells (x, y on the half-cell lattice). */
  function tileDots(t, shapes) {
    var out = [];
    for (var i = 0; i < shapes.length; i++) {
      var s = shapes[i];
      if (!isVertexDot(t, s)) continue;
      var p = tileCellOf(t, (s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2);
      out.push({ x: Math.round(p.c * 2) / 2, y: Math.round(p.r * 2) / 2, r: (s.x1 - s.x0) / 2 / t.cellW, hex: s.hex });
    }
    return out;
  }

  /**
   * legendOf(shapes) -> { rows: [{ hex, mask, box }] } | null
   * A KG-Chart key page draws one swatch square per colour in a column, each
   * with the colour's symbol drawn on it, top to bottom in key order.
   */
  function legendOf(shapes) {
    var squares = [], i, j;
    for (i = 0; i < shapes.length; i++) {
      var s = shapes[i];
      if (!s.rect) continue;
      var w = s.x1 - s.x0, h = s.y1 - s.y0;
      if (!(w > 2) || Math.abs(w - h) > w * 0.08) continue;
      squares.push(s);
    }
    /* a key has tens of swatches, not thousands (a page of thousands of
       squares that did not read as a chart is not a key either) */
    if (squares.length < 2 || squares.length > 1500 || shapes.length > 30000) return null;
    /* the biggest column of same-size squares */
    var best = null;
    for (i = 0; i < squares.length; i++) {
      var col = [squares[i]], wi = squares[i].x1 - squares[i].x0;
      for (j = 0; j < squares.length; j++) {
        if (j === i) continue;
        var wj = squares[j].x1 - squares[j].x0;
        if (Math.abs(wj - wi) <= wi * 0.05 && Math.abs(squares[j].x0 - squares[i].x0) <= wi * 0.1) col.push(squares[j]);
      }
      if (!best || col.length > best.length) best = col;
      if (best.length > squares.length / 2) break;
    }
    if (!best || best.length < 2) return null;
    best.sort(function (a, b) { return b.y1 - a.y1 || a.x0 - b.x0; });
    /* drop exact duplicates (a square drawn twice) */
    var uniq = [];
    for (i = 0; i < best.length; i++) {
      if (uniq.length && Math.abs(uniq[uniq.length - 1].y1 - best[i].y1) < (best[i].y1 - best[i].y0) * 0.2) continue;
      uniq.push(best[i]);
    }
    if (uniq.length < 2) return null;
    var rows = [], withGlyph = 0;
    for (i = 0; i < uniq.length; i++) {
      var sq = uniq[i], inner = [], sw = sq.x1 - sq.x0;
      for (j = 0; j < shapes.length; j++) {
        var g = shapes[j];
        if (g === sq) continue;
        if (g.x0 < sq.x0 - sw * 0.02 || g.x1 > sq.x1 + sw * 0.02 || g.y0 < sq.y0 - sw * 0.02 || g.y1 > sq.y1 + sw * 0.02) continue;
        if (g.rect && Math.abs((g.x1 - g.x0) - sw) < sw * 0.1 && Math.abs((g.y1 - g.y0) - sw) < sw * 0.1) continue;
        inner.push(shapePolys(g));
      }
      var mask = shapeMask(inner, { x0: sq.x0, y0: sq.y0, x1: sq.x1, y1: sq.y1 });
      if (mask) withGlyph++;
      rows.push({ hex: sq.hex, mask: mask, polys: inner, box: { x0: sq.x0, y0: sq.y0, x1: sq.x1, y1: sq.y1 } });
    }
    /* a column of plain squares with nothing on them is not a key */
    if (withGlyph < rows.length * 0.5) return null;
    return { rows: rows };
  }

  /**
   * Page-space shapes (each a list of polygons) -> the same in a unit box
   * (0..1, y DOWN), 3 decimals. Shapes stay separate: a pixel is inked when
   * it is inside ANY shape (each shape even-odd on its own), so two bars that
   * cross make a "+" and a ring drawn as one shape keeps its hole.
   */
  function unitPolys(shapeList, box) {
    var bw = box.x1 - box.x0, bh = box.y1 - box.y0, out = [];
    for (var a = 0; a < shapeList.length; a++) {
      var shape = [];
      for (var b = 0; b < shapeList[a].length; b++) {
        var p = shapeList[a][b], q = [];
        for (var v = 0; v < p.length; v += 2) {
          q.push(Math.round((p[v] - box.x0) / bw * 1000) / 1000, Math.round((box.y1 - p[v + 1]) / bh * 1000) / 1000);
        }
        shape.push(q);
      }
      if (shape.length) out.push(shape);
    }
    return out;
  }

  /**
   * glyphFromPolys(unitPolys, opts) -> palette glyph { w, h, bits, path, clean, source }
   * (the same shape as XSKeyRead's Glyph). `bits` is 16 x 16, 1 bit a pixel,
   * row-major from the top, base64; `path` an SVG path in a 100 x 100 box
   * (y down), null when it would be over 1 KB.
   */
  function glyphFromPolys(polys, opts) {
    opts = isObj(opts) ? opts : {};
    if (!Array.isArray(polys) || !polys.length) return null;
    /* accept a flat list of polygons as one shape per polygon */
    var shapes = [], i, r, c;
    for (i = 0; i < polys.length; i++) {
      if (!Array.isArray(polys[i]) || !polys[i].length) continue;
      shapes.push(typeof polys[i][0] === 'number' ? [polys[i]] : polys[i]);
    }
    if (!shapes.length) return null;
    var N = 16, bits = new Uint8Array(N * N), any = false;
    for (r = 0; r < N; r++) {
      for (c = 0; c < N; c++) {
        var x = (c + 0.5) / N, y = (r + 0.5) / N;
        for (i = 0; i < shapes.length; i++) {
          if (insideShape(shapes[i], x, y)) { bits[r * N + c] = 1; any = true; break; }
        }
      }
    }
    if (!any) return null;
    var parts = [], flat = [];
    for (i = 0; i < shapes.length; i++) for (var f = 0; f < shapes[i].length; f++) flat.push(shapes[i][f]);
    for (i = 0; i < flat.length; i++) {
      var p = flat[i], s = 'M';
      for (var v = 0; v < p.length; v += 2) {
        s += (v ? ' L' : '') + Math.round(p[v] * 100) + ' ' + Math.round(p[v + 1] * 100);
      }
      parts.push(s + 'Z');
    }
    var path = parts.join('');
    return {
      w: N, h: N, bits: packBits(bits, N * N),
      path: path.length <= 1024 ? path : null,
      clean: !!opts.clean,
      source: opts.source || 'pdf-path'
    };
  }

  /**
   * tileGraphics(tile, out) — the tile's stroked segments and vertex dots, in
   * whole-chart cells, appended to out.segments / out.circles (#10 input).
   */
  function tileGraphics(t, out) {
    if (!t || !t.place) return;
    var px = t.place.col, py = t.place.row, i;
    var segs = t.segs || [];
    /* the grid itself: whatever colour + width strokes a fifth or more of
       the page's segments is grid, not backstitch */
    var tally = {}, gridKey = {};
    for (i = 0; i < segs.length; i++) {
      var tk = segs[i].hex + '|' + Math.round(segs[i].width * 100);
      tally[tk] = (tally[tk] || 0) + 1;
    }
    for (var gk2 in tally) if (tally.hasOwnProperty(gk2) && tally[gk2] >= Math.max(20, segs.length * 0.2)) gridKey[gk2] = 1;
    for (i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (gridKey[s.hex + '|' + Math.round(s.width * 100)]) continue;
      var a = tileCellOf(t, s.x1, s.y1), b = tileCellOf(t, s.x2, s.y2);
      if (a.c < -0.05 || a.r < -0.05 || b.c < -0.05 || b.r < -0.05) continue;
      if (a.c > t.gc + 0.05 || b.c > t.gc + 0.05 || a.r > t.gr + 0.05 || b.r > t.gr + 0.05) continue;
      out.segments.push({ x1: a.c + px, y1: a.r + py, x2: b.c + px, y2: b.r + py, hex: s.hex,
        width: Math.round(s.width / t.cellW * 1000) / 1000 });
    }
    var dots = t.dots || [];
    for (i = 0; i < dots.length; i++) {
      out.circles.push({ x: dots[i].x + px, y: dots[i].y + py, r: dots[i].r, hex: dots[i].hex });
    }
    t.segs = null;
    t.dots = null;
  }

  /**
   * normMask(unitShapes) -> mask of the symbol in its OWN box (aspect kept,
   * centred). KG-Chart draws a key swatch's symbol bigger and lower in its
   * square than the same symbol in a chart cell, so the legend is matched to
   * the cells on this, not on the cell-relative mask.
   */
  function normMask(shapes) {
    if (!Array.isArray(shapes) || !shapes.length) return '';
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, a, b, v;
    for (a = 0; a < shapes.length; a++) {
      for (b = 0; b < shapes[a].length; b++) {
        var p = shapes[a][b];
        for (v = 0; v < p.length; v += 2) {
          if (p[v] < x0) x0 = p[v];
          if (p[v] > x1) x1 = p[v];
          if (p[v + 1] < y0) y0 = p[v + 1];
          if (p[v + 1] > y1) y1 = p[v + 1];
        }
      }
    }
    var side = Math.max(x1 - x0, y1 - y0);
    if (!(side > 0)) return '';
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    /* shapeMask samples a y-up box from its top: hand it the y-down unit
       shapes with the box flipped accordingly */
    var flipped = [];
    for (a = 0; a < shapes.length; a++) {
      var sh = [];
      for (b = 0; b < shapes[a].length; b++) {
        var q = shapes[a][b], f = [];
        for (v = 0; v < q.length; v += 2) f.push(q[v], -q[v + 1]);
        sh.push(f);
      }
      flipped.push(sh);
    }
    return shapeMask(flipped, { x0: cx - side / 2, x1: cx + side / 2, y0: -cy - side / 2, y1: -cy + side / 2 });
  }

  function sigMask(sig) {
    var s = sig || '', b = s.indexOf('|');
    return b < 0 ? s : s.slice(0, b);
  }
  function sigText(sig) {
    var s = sig || '', b = s.indexOf('|');
    return b < 0 ? '' : s.slice(b);
  }

  /**
   * sigGroups(hist) -> [{ sig, n, members:[sig] }] largest first: the cells
   * of one ink grouped by the symbol drawn in them. A group within 4 of 64
   * samples of a bigger one (the same symbol, rasterised a hair apart) is
   * folded into it.
   */
  function sigGroups(hist) {
    var keys = Object.keys(hist), groups = [], i, j;
    keys.sort(function (a, b) { return hist[b] - hist[a] || (a < b ? -1 : 1); });
    for (i = 0; i < keys.length; i++) {
      var k = keys[i], home = null;
      for (j = 0; j < groups.length; j++) {
        if (sigText(groups[j].sig) === sigText(k) && maskNear(sigMask(groups[j].sig), sigMask(k)) <= SIG_NEAR) { home = groups[j]; break; }
      }
      if (home) { home.n += hist[k]; home.members.push(k); }
      else groups.push({ sig: k, n: hist[k], members: [k] });
    }
    return groups;
  }

  /** Unmatched key rows whose counts add up to n (2 or 3 of them), or null. */
  function sumSubset(n, cand, entries) {
    var tol = Math.max(2, n * 0.01), i, j, k;
    for (i = 0; i < cand.length; i++) {
      for (j = i + 1; j < cand.length; j++) {
        var s2 = entries[cand[i]].stitchCount + entries[cand[j]].stitchCount;
        if (Math.abs(s2 - n) <= tol) return [cand[i], cand[j]];
      }
    }
    if (cand.length > 24) return null;
    for (i = 0; i < cand.length; i++) {
      for (j = i + 1; j < cand.length; j++) {
        for (k = j + 1; k < cand.length; k++) {
          var s3 = entries[cand[i]].stitchCount + entries[cand[j]].stitchCount + entries[cand[k]].stitchCount;
          if (Math.abs(s3 - n) <= tol) return [cand[i], cand[j], cand[k]];
        }
      }
    }
    return null;
  }

  /**
   * nameClasses(raw, sigs, inks, counts, entries, legends, sigPolys)
   *   raw      Int32Array, per cell an index into inks (-1 empty)
   *   sigs     per cell the symbol signature (tileSigs)
   *   inks     the distinct fills ('5b5b5b', or 'font\u0001glyph')
   *   counts   cells per ink
   *   entries  parseKey entries
   *   legends  legendOf() results from the key pages
   * -> { classes:[{ ink, n, entry, why }], cellClass:Int32Array, classPal:[],
   *      inkMatched:[], placeholders:[{ ink, n, candidates, why }], split:[],
   *      glyphs:[per entry], legendRows, legendUsed, legendPage }
   *
   * classPal[c] is the entry index, or -2 - k for placeholder k.
   */
  function nameClasses(raw, sigs, inks, counts, entries, legends, sigPolys) {
    sigPolys = sigPolys || {};
    var nCells = raw.length, i, j, k;
    var crossIdx = [];
    for (i = 0; i < entries.length; i++) if (CHECK_KINDS[(entries[i] && entries[i].kind) || 'cross']) crossIdx.push(i);
    var hasCount = function (e) { return typeof e.stitchCount === 'number' && e.stitchCount > 0; };

    /* per ink, the symbols drawn in its cells */
    var hist = [];
    for (i = 0; i < inks.length; i++) hist.push({});
    for (i = 0; i < nCells; i++) {
      var ri = raw[i];
      if (ri < 0) continue;
      var sg = sigs[i] || '';
      hist[ri][sg] = (hist[ri][sg] || 0) + 1;
    }
    var filled = 0;
    for (i = 0; i < counts.length; i++) filled += counts[i];

    var classes = [], classByKey = {};
    function classFor(ink, entry, why) {
      var key = entry >= 0 ? 'e' + entry : 'u' + ink + ':' + why;
      if (classByKey.hasOwnProperty(key)) return classByKey[key];
      classByKey[key] = classes.length;
      classes.push({ ink: inks[ink], inkIndex: ink, n: 0, entry: entry, why: entry >= 0 ? null : why, candidates: [] });
      return classes.length - 1;
    }
    /* inkSig[ink][sig] -> class */
    var inkSig = [];
    for (i = 0; i < inks.length; i++) inkSig.push({});
    var split = [], legendUsed = false, legendRows = 0, legendPage = null, inkMatched = [];
    for (i = 0; i < inks.length; i++) inkMatched.push(false);
    var legendMask = {};

    /* ---- 1. the key page's own swatches, when they are the key's rows ---- */
    var legend = null;
    for (i = 0; i < (legends || []).length; i++) {
      if (legends[i].rows.length === crossIdx.length && crossIdx.length >= 2) { legend = legends[i]; break; }
    }
    /* a long key carried over several pages, in page order */
    if (!legend && legends && legends.length > 1 && crossIdx.length >= 2) {
      var joined = [];
      for (i = 0; i < legends.length; i++) joined = joined.concat(legends[i].rows);
      if (joined.length === crossIdx.length) legend = { rows: joined, page: legends[0].page };
    }
    if (legend) {
      legendRows = legend.rows.length;
      var byInk = {};
      for (i = 0; i < legend.rows.length; i++) (byInk[legend.rows[i].hex] = byInk[legend.rows[i].hex] || []).push(i);
      var covered = 0;
      for (i = 0; i < inks.length; i++) if (byInk[inks[i]]) covered += counts[i];
      var normCache = {};
      var normOf = function (mk) {
        if (!normCache.hasOwnProperty(mk)) normCache[mk] = sigPolys[mk] ? normMask(sigPolys[mk]) : '';
        return normCache[mk];
      };
      for (i = 0; i < legend.rows.length; i++) {
        var lrow = legend.rows[i];
        if (lrow.norm === undefined) lrow.norm = normMask(unitPolys(lrow.polys, lrow.box));
      }
      if (filled && covered / filled >= 0.8) {
        var trial = [], perEntry = {};
        for (i = 0; i < inks.length; i++) {
          var rowsHere = byInk[inks[i]] || [], sk = Object.keys(hist[i]), m = {};
          for (j = 0; j < sk.length; j++) {
            var e = -1;
            if (rowsHere.length === 1) e = crossIdx[rowsHere[0]];
            else if (rowsHere.length > 1) {
              var bestD = 999, second = 999, bestR = -1, mk = normOf(sigMask(sk[j]));
              for (k = 0; k < rowsHere.length; k++) {
                var d = maskNear(mk, legend.rows[rowsHere[k]].norm);
                if (d < bestD) { second = bestD; bestD = d; bestR = rowsHere[k]; }
                else if (d < second) second = d;
              }
              if (bestR >= 0 && bestD <= SIG_FAR && second >= bestD * 2 + 6) e = crossIdx[bestR];
            }
            m[sk[j]] = e;
            if (e >= 0) perEntry[e] = (perEntry[e] || 0) + hist[i][sk[j]];
          }
          trial.push(m);
        }
        /* the swatch order is the key's order only if the counts agree */
        var withCount = 0, agreeing = 0;
        for (i = 0; i < crossIdx.length; i++) {
          var ce = entries[crossIdx[i]];
          if (!hasCount(ce)) continue;
          withCount++;
          if (Math.abs((perEntry[crossIdx[i]] || 0) - ce.stitchCount) <= Math.max(2, ce.stitchCount * 0.01)) agreeing++;
        }
        if (!withCount || agreeing / withCount >= 0.9) {
          legendUsed = true;
          legendPage = legend.page || null;
          for (i = 0; i < legend.rows.length; i++) legendMask[crossIdx[i]] = legend.rows[i];
          for (i = 0; i < inks.length; i++) {
            var sks = Object.keys(trial[i]), into = {}, anyMatch = false, anyMiss = false;
            for (j = 0; j < sks.length; j++) {
              var en = trial[i][sks[j]];
              if (en >= 0) { inkSig[i][sks[j]] = classFor(i, en, null); into[en] = 1; anyMatch = true; }
              else { inkSig[i][sks[j]] = -1; anyMiss = true; }
            }
            inkMatched[i] = anyMatch && !anyMiss;
            var intoList = Object.keys(into).map(Number);
            if (intoList.length > 1) split.push({ ink: inks[i], by: 'legend', into: intoList.sort(function (a, b) { return a - b; }) });
          }
        }
      }
    }

    var usedEntry = {};
    var ties = [];
    if (!legendUsed) {
      /* ---- 2. counts (and printed text symbols, and colours) ---- */
      var marks = [];
      for (i = 0; i < inks.length; i++) marks.push({ id: inks[i], n: counts[i] });
      var tieOut = {};
      var map = matchGlyphs(marks, entries, tieOut);
      ties = tieOut.ties || [];
      var tied = {};
      for (i = 0; i < ties.length; i++) for (j = 0; j < ties[i].marks.length; j++) tied[ties[i].marks[j]] = ties[i];
      for (i = 0; i < inks.length; i++) {
        var me = map[inks[i]];
        if (me !== undefined) {
          usedEntry[me] = 1;
          inkMatched[i] = true;
          var c0 = classFor(i, me, null), hk = Object.keys(hist[i]);
          for (j = 0; j < hk.length; j++) inkSig[i][hk[j]] = c0;
        }
      }
      for (i = 0; i < ties.length; i++) for (j = 0; j < ties[i].entries.length; j++) usedEntry[ties[i].entries[j]] = 1;
      /* an ink no key row's count fits: split it by the symbol drawn in its
         cells, when the parts' counts each fit a key row */
      for (i = 0; i < inks.length; i++) {
        if (inkMatched[i] || tied[inks[i]] || !counts[i]) continue;
        var groups = sigGroups(hist[i]);
        if (groups.length < 2) continue;
        var rem = [];
        for (j = 0; j < crossIdx.length; j++) {
          if (!usedEntry[crossIdx[j]] && hasCount(entries[crossIdx[j]])) rem.push(crossIdx[j]);
        }
        if (!rem.length) continue;
        var subMarks = groups.map(function (g, gi) { return { id: 'g' + gi, n: g.n }; });
        var subEntries = rem.map(function (q) { return { stitchCount: entries[q].stitchCount, symbol: '', hex: null }; });
        var subMap = matchGlyphs(subMarks, subEntries);
        var intoS = [];
        for (j = 0; j < groups.length; j++) {
          var se = subMap['g' + j];
          if (se === undefined) continue;
          var realE = rem[se];
          usedEntry[realE] = 1;
          intoS.push(realE);
          var cs = classFor(i, realE, null);
          for (k = 0; k < groups[j].members.length; k++) inkSig[i][groups[j].members[k]] = cs;
        }
        if (intoS.length) split.push({ ink: inks[i], by: 'glyph', into: intoS.sort(function (a, b) { return a - b; }) });
        if (intoS.length === groups.length) inkMatched[i] = true;
      }
    }

    /* ---- 3. whatever is left is said out loud, never dropped ---- */
    var unmatchedCross = [];
    for (i = 0; i < crossIdx.length; i++) {
      var ci2 = crossIdx[i];
      var hasCells = classByKey.hasOwnProperty('e' + ci2);
      if (!hasCells && !usedEntry[ci2]) unmatchedCross.push(ci2);
    }
    var placeholders = [];
    for (i = 0; i < inks.length; i++) {
      var hk2 = Object.keys(hist[i]), left = 0;
      for (j = 0; j < hk2.length; j++) if (!(inkSig[i][hk2[j]] >= 0)) left += hist[i][hk2[j]];
      if (!left) continue;
      var why = 'unknown', cands = [];
      var tie = null;
      for (j = 0; j < ties.length; j++) if (ties[j].marks.indexOf(inks[i]) >= 0) tie = ties[j];
      if (tie) { why = 'tie'; cands = tie.entries.slice().sort(function (a, b) { return a - b; }); }
      else {
        var withCounts = unmatchedCross.filter(function (q) { return hasCount(entries[q]); });
        var sub = sumSubset(left, withCounts, entries);
        if (sub) { why = 'shared-ink'; cands = sub.sort(function (a, b) { return a - b; }); }
        else {
          cands = withCounts.slice().sort(function (a, b) {
            return Math.abs(entries[a].stitchCount - left) - Math.abs(entries[b].stitchCount - left) || a - b;
          }).slice(0, 6);
        }
      }
      var cu = classFor(i, -1, why);
      classes[cu].candidates = cands;
      for (j = 0; j < hk2.length; j++) if (!(inkSig[i][hk2[j]] >= 0)) inkSig[i][hk2[j]] = cu;
      placeholders.push({ ink: inks[i], n: 0, candidates: cands, why: why, cls: cu });
    }

    /* per-cell class, counts per class */
    var cellClass = new Int32Array(nCells);
    for (i = 0; i < nCells; i++) {
      var r2 = raw[i];
      if (r2 < 0) { cellClass[i] = -1; continue; }
      var cc = inkSig[r2][sigs[i] || ''];
      cellClass[i] = cc;
      classes[cc].n++;
    }
    var classPal = [];
    for (i = 0; i < classes.length; i++) classPal.push(classes[i].entry);
    for (i = 0; i < placeholders.length; i++) {
      placeholders[i].n = classes[placeholders[i].cls].n;
      classPal[placeholders[i].cls] = -2 - i;
    }

    /* ---- R5: the designer's own symbol per key row ---- */
    var glyphs = [];
    for (i = 0; i < entries.length; i++) glyphs.push(null);
    var entryMasks = {};
    for (i = 0; i < inks.length; i++) {
      var hk3 = Object.keys(hist[i]);
      for (j = 0; j < hk3.length; j++) {
        var cl = classes[inkSig[i][hk3[j]]];
        if (!cl || cl.entry < 0) continue;
        var em = entryMasks[cl.entry] = entryMasks[cl.entry] || {};
        var mk2 = sigMask(hk3[j]);
        em[mk2] = (em[mk2] || 0) + hist[i][hk3[j]];
      }
    }
    for (i = 0; i < entries.length; i++) {
      var ems = entryMasks[i];
      if (!ems) {
        if (legendMask[i] && legendMask[i].mask) {
          glyphs[i] = glyphFromPolys(unitPolys(legendMask[i].polys, legendMask[i].box), { clean: true, source: 'pdf-path' });
        }
        continue;
      }
      var tot = 0, top = '', topN = -1, mks = Object.keys(ems);
      for (j = 0; j < mks.length; j++) { tot += ems[mks[j]]; if (ems[mks[j]] > topN) { topN = ems[mks[j]]; top = mks[j]; } }
      var lg = legendMask[i];
      if (!top && !(lg && lg.mask)) continue;
      var agreeN = 0;
      for (j = 0; j < mks.length; j++) if (maskNear(mks[j], top) <= SIG_NEAR) agreeN += ems[mks[j]];
      /* clean: (nearly) every cell of the colour shows the same symbol, and
         it is the symbol the key page prints for it */
      var clean = !!top && tot > 0 && agreeN / tot >= 0.99 &&
        (!lg || !lg.norm || maskNear(normMask(sigPolys[top]), lg.norm) <= SIG_FAR);
      var polys = lg ? unitPolys(lg.polys, lg.box) : sigPolys[top];
      if (polys) glyphs[i] = glyphFromPolys(polys, { clean: clean, source: 'pdf-path' });
    }

    return {
      classes: classes, cellClass: cellClass, classPal: classPal, inkMatched: inkMatched,
      placeholders: placeholders, split: split, glyphs: glyphs,
      legendRows: legendRows, legendUsed: legendUsed, legendPage: legendPage
    };
  }

  /**
   * solveCluster(markIdx, entryIdx, marks, entries) -> [[mark, entry]] | null
   * Marks and key entries whose counts are all within a few stitches of each
   * other. The pairing with the smallest count error wins when it is the
   * only one; when several pairings fit the counts equally well, the mark
   * colours decide, but only by a clear margin. null = a real tie.
   */
  function solveCluster(cm, ce, marks, entries) {
    var k = Math.min(cm.length, ce.length), best = [], bestCost = Infinity;
    function walk(i, usedSet, acc, cost) {
      if (cost > bestCost) return;
      if (i === k) {
        if (cost < bestCost) { bestCost = cost; best = [acc.slice()]; }
        else best.push(acc.slice());
        return;
      }
      /* marks (or entries, whichever is the shorter list) go in order */
      for (var j = 0; j < (cm.length <= ce.length ? ce.length : cm.length); j++) {
        if (usedSet[j]) continue;
        var m = cm.length <= ce.length ? cm[i] : cm[j];
        var e = cm.length <= ce.length ? ce[j] : ce[i];
        usedSet[j] = 1;
        acc.push([m, e]);
        walk(i + 1, usedSet, acc, cost + Math.abs(marks[m].n - entries[e].stitchCount));
        acc.pop();
        usedSet[j] = 0;
      }
    }
    walk(0, {}, [], 0);
    if (!best.length) return null;
    if (best.length === 1) return best[0];
    /* equal on counts: try the colours */
    var scored = [];
    for (var b = 0; b < best.length; b++) {
      var tot = 0, okc = true;
      for (var p = 0; p < best[b].length; p++) {
        var mh = /^[0-9a-f]{6}$/.test(marks[best[b][p][0]].id) ? marks[best[b][p][0]].id : null;
        var eh = entries[best[b][p][1]].hex;
        var la = mh && hexToLab(mh), lb = eh && hexToLab(eh);
        if (!la || !lb) { okc = false; break; }
        tot += deltaE2000(la, lb);
      }
      if (!okc) return null;
      scored.push(tot);
    }
    var order = scored.map(function (v, i) { return i; }).sort(function (a, c) { return scored[a] - scored[c]; });
    if (scored[order[1]] - scored[order[0]] >= 8) return best[order[0]];
    return null;
  }

  /** Greedy glyph -> key-entry assignment (symbol, then counts, then colour). */
  function matchGlyphs(marks, entries, out) {
    var i, j, map = {}, usedE = {}, usedM = {};
    var byCount = {}, colByCount = {};
    for (i = 0; i < entries.length; i++) {
      var sc = entries[i].stitchCount;
      if (sc === null || sc === undefined) continue;
      (byCount[sc] = byCount[sc] || []).push(i);
    }
    for (i = 0; i < marks.length; i++) {
      (colByCount[marks[i].n] = colByCount[marks[i].n] || []).push(i);
    }

    /* 1. the symbol the key printed, when the mark is a real text glyph */
    for (i = 0; i < marks.length; i++) {
      var glyph = marks[i].id.indexOf('\u0001') > 0 ? marks[i].id.split('\u0001')[1] : '';
      if (!glyph) continue;
      for (j = 0; j < entries.length; j++) {
        if (usedE[j]) continue;
        if (str(entries[j].symbol, '') === glyph) {
          map[marks[i].id] = j; usedE[j] = 1; usedM[i] = 1; break;
        }
      }
    }

    /* 2. a stitch count that is unique on both sides */
    var ks = Object.keys(colByCount);
    for (i = 0; i < ks.length; i++) {
      var cs = colByCount[ks[i]], es = byCount[ks[i]];
      if (!cs || !es || cs.length !== 1 || es.length !== 1) continue;
      if (usedM[cs[0]] || usedE[es[0]]) continue;
      map[marks[cs[0]].id] = es[0]; usedE[es[0]] = 1; usedM[cs[0]] = 1;
    }

    /* 3. frequency ranking: both sides sorted descending, paired within 3% */
    var rm = [], re = [];
    for (i = 0; i < marks.length; i++) if (!usedM[i]) rm.push(i);
    for (j = 0; j < entries.length; j++) {
      if (usedE[j]) continue;
      if (entries[j].stitchCount === null || entries[j].stitchCount === undefined) continue;
      re.push(j);
    }
    rm.sort(function (a, b) { return marks[b].n - marks[a].n; });
    re.sort(function (a, b) { return entries[b].stitchCount - entries[a].stitchCount; });
    var mi = 0, ei = 0;
    while (mi < rm.length && ei < re.length) {
      var mn = marks[rm[mi]].n, en = entries[re[ei]].stitchCount;
      var tol = Math.max(3, en * 0.03);
      if (Math.abs(mn - en) <= tol) {
        /* Wave K: when another mark or entry is just as close, the counts
           cannot say which is which (pacman: DMC 3846 and DMC 728 both
           print 126). Pairing them in sort order was a coin toss; now the
           colours decide when they clearly can, else it is a tie. */
        var mj = mi, ej = ei;
        while (mj + 1 < rm.length && Math.abs(marks[rm[mj + 1]].n - en) <= tol) mj++;
        while (ej + 1 < re.length && Math.abs(entries[re[ej + 1]].stitchCount - mn) <= tol) ej++;
        if ((mj > mi || ej > ei) && mj - mi <= 5 && ej - ei <= 5) {
          var cm = rm.slice(mi, mj + 1), ce = re.slice(ei, ej + 1);
          var pairs = solveCluster(cm, ce, marks, entries);
          if (pairs) {
            for (var pq = 0; pq < pairs.length; pq++) {
              map[marks[pairs[pq][0]].id] = pairs[pq][1]; usedE[pairs[pq][1]] = 1; usedM[pairs[pq][0]] = 1;
            }
          } else {
            for (pq = 0; pq < cm.length; pq++) usedM[cm[pq]] = 2;
            for (pq = 0; pq < ce.length; pq++) usedE[ce[pq]] = 2;
            if (out) (out.ties = out.ties || []).push({ marks: cm.map(function (q) { return marks[q].id; }), entries: ce.slice() });
          }
          mi = mj + 1; ei = ej + 1;
          continue;
        }
        map[marks[rm[mi]].id] = re[ei]; usedE[re[ei]] = 1; usedM[rm[mi]] = 1;
        mi++; ei++;
      } else if (mn > en) { mi++; } else { ei++; }
    }

    /* 4. whatever is left: nearest colour, when the mark carries one */
    for (i = 0; i < marks.length; i++) {
      if (usedM[i]) continue;
      var mhex = /^[0-9a-f]{6}$/.test(marks[i].id) ? marks[i].id : null;
      if (!mhex) continue;
      var lab = hexToLab(mhex), bestJ = -1, bestD = 1e9;
      if (!lab) continue;
      for (j = 0; j < entries.length; j++) {
        if (usedE[j] || !entries[j].hex) continue;
        var el = hexToLab(entries[j].hex);
        if (!el) continue;
        var dd = deltaE76(lab, el);
        if (dd < bestD) { bestD = dd; bestJ = j; }
      }
      if (bestJ >= 0 && bestD < 30) { map[marks[i].id] = bestJ; usedE[bestJ] = 1; usedM[i] = 1; }
    }
    return map;
  }

  /**
   * extractGrid(doc, pageNo, opts) -> Promise<Result>   (B3.4, beta)
   *
   *   doc     a pdf.js PDFDocumentProxy, or a PdfText.open() handle
   *   pageNo  a 1-based page to read on its own, or null/0 for the whole
   *           document (the normal case: every chart page becomes a tile and
   *           the tiles are placed by their ruler numbers)
   *   opts = {
   *     key,                 // the parseKey result, for naming the colours
   *     design: { w, h },    // the declared design size, when known
   *     onProgress(page, total),
   *     cancelled() -> bool, // polled between pages
   *     maxPages: 200, budgetMs: 30000
   *   }
   *
   * Result = { ok, w, h, originX, originY, cellW, cellH, cells: Int16Array,
   *            glyphs: string[], counts: number[], palette, colors, matched,
   *            agree, confidence, ms, pages, tiles, warnings,
   *            regions: [{ page (1-based), region }] }   // wave F, see tileRegion
   */
  /* How much of the budget may go on pages with no chart on them before the
     reader stops looking. */
  var EARLY_OUT_SHARE = 0.4;

  function extractGrid(doc, pageNo, opts) {
    opts = isObj(opts) ? opts : {};
    var warnings = [];
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    function now() { return ((window.performance && performance.now) ? performance.now() : Date.now()) - t0; }
    function fail(msg, extra) {
      pushOnce(warnings, msg);
      var out = {
        ok: false, w: 0, h: 0, originX: 0, originY: 0, cellW: 0, cellH: 0,
        cells: new Int16Array(0), glyphs: [], counts: [], palette: null,
        colors: 0, matched: 0, agree: 0, countable: 0, filled: 0, confidence: 0,
        ms: Math.round(now()), pages: 0, tiles: 0, regions: [], warnings: warnings
      };
      if (extra) { for (var k in extra) if (extra.hasOwnProperty(k)) out[k] = extra[k]; }
      return out;
    }

    var pdf = doc && doc.getPage ? doc : (doc && doc.doc && doc.doc.getPage ? doc.doc : null);
    if (!pdf) return Promise.resolve(fail('no PDF to read'));
    var OPS = pdfOps();
    var total = clampInt(pdf.numPages, 1, 5000, 1);
    var first = 1, last = total;
    if (pageNo) {
      first = last = clampInt(pageNo, 1, total, 1);
    }
    var maxPages = clampInt(opts.maxPages, 1, 5000, 200);
    if (last - first + 1 > maxPages) last = first + maxPages - 1;
    var budget = clampInt(opts.budgetMs, 1000, 600000, 30000);

    var tiles = [], pending = [], legends = [], scanned = 0, misses = 0, stopped = false;
    /* Stroked segments are only kept when the key has backstitch, knots or
       beads to find (or opts.graphics asks): a KG page strokes every square
       edge, 3,700 segments a page, and Pokémon has 70 pages. */
    var wantSegs = opts.graphics === true;
    var kEntries = isObj(opts.key) && Array.isArray(opts.key.entries) ? opts.key.entries : [];
    for (var ke = 0; ke < kEntries.length && !wantSegs; ke++) {
      var kk = kEntries[ke] && kEntries[ke].kind;
      if (kk === 'back' || kk === 'knot' || kk === 'bead') wantSegs = true;
    }
    if (opts.graphics === false) wantSegs = false;

    function step(n) {
      if (n > last || stopped) return Promise.resolve();
      if (now() > budget) { pushOnce(warnings, 'gave up after ' + Math.round(budget / 1000) + ' seconds'); stopped = true; return Promise.resolve(); }
      if (typeof opts.cancelled === 'function' && opts.cancelled()) { stopped = true; return Promise.resolve(); }
      if (typeof opts.onProgress === 'function') {
        try { opts.onProgress(n - first + 1, last - first + 1); } catch (e) { /* ignore */ }
      }
      return pdf.getPage(n).then(function (page) {
        return extractPage(page, OPS, wantSegs);
      }, function () { return null; }).then(function (res) {
        scanned++;
        if (res && res.tile) { res.tile.page = n; tiles.push(res.tile); misses = 0; }
        else if (res && res.pending) { res.page = n; pending.push(res); misses = 0; }
        else {
          if (res && res.legend) { res.legend.page = n; legends.push(res.legend); }
          misses++;
          /* Nothing that looks like a chart in the first handful of pages:
             stop early so a PDF with no grid fails in under a second.
             A page of a scanned book is a single huge JPEG and can cost
             more than a second to build an operator list for, so six of
             them would blow any sane budget — once a share of the budget
             has gone on misses alone, two are enough to call it. */
          if (!tiles.length && !pageNo &&
              (misses >= 6 || (misses >= 2 && now() > budget * EARLY_OUT_SHARE))) {
            stopped = true;
            return;
          }
        }
        return new Promise(function (r) { window.setTimeout(r, 0); }).then(function () {
          return step(n + 1);
        });
      });
    }

    /* Second pass: tiles too narrow to fit a pitch to, retried with the pitch
       the rest of the chart agreed on. */
    function retryPending() {
      if (!tiles.length || !pending.length) return;
      var ws = [], hs = [], ks = {};
      for (var i = 0; i < tiles.length; i++) {
        ws.push(tiles[i].fx.pitch); hs.push(tiles[i].fy.pitch);
        ks[tiles[i].K] = (ks[tiles[i].K] || 0) + 1;
      }
      ws.sort(function (a, b) { return a - b; });
      hs.sort(function (a, b) { return a - b; });
      var forced = {
        pitchX: ws[Math.floor(ws.length / 2)],
        pitchY: hs[Math.floor(hs.length / 2)],
        K: modeKey(ks).value || 1
      };
      for (var p = 0; p < pending.length; p++) {
        var lat = latticeOf(pending[p].pending, pending[p].hint, forced);
        if (!lat) continue;
        var t = mergeTile(lat, rulerK(lat, pending[p].nums) || forced.K);
        if (!t) continue;
        t.source = 'edge';
        t.page = pending[p].page;
        t.pageBox = pending[p].pageBox || null;
        t.place = placeTile(t, pending[p].nums);
        t.sig = tileSigs(t, pending[p].shapes || [], pending[p].marks || []);
        t.segs = (pending[p].segs || []).length <= 50000 ? (pending[p].segs || []) : [];
        t.dots = tileDots(t, pending[p].shapes || []);
        tiles.push(t);
      }
      for (var pf = 0; pf < pending.length; pf++) { pending[pf].shapes = null; pending[pf].segs = null; }
      tiles.sort(function (a, b) { return a.page - b.page; });
    }

    return step(first).then(function () {
      retryPending();
      return null;
    }).then(function () {
      if (typeof opts.cancelled === 'function' && opts.cancelled()) {
        return fail('cancelled');
      }
      if (!tiles.length) {
        return fail('no chart grid found in this PDF', { pages: scanned });
      }

      /* ---- place the tiles ---- */
      var i, t, haveLabels = 0;
      for (i = 0; i < tiles.length; i++) {
        t = tiles[i];
        if (t.place && t.place.col !== null && t.place.row !== null) haveLabels++;
      }
      if (haveLabels < tiles.length) {
        /* fall back to page order at the first tile's size */
        var tw = tiles[0].gc, th = tiles[0].gr;
        var declaredW = isObj(opts.design) ? clampInt(opts.design.w, 1, 20000, 0) : 0;
        var perRow = declaredW ? Math.ceil(declaredW / tw) : Math.ceil(Math.sqrt(tiles.length));
        if (perRow < 1) perRow = 1;
        for (i = 0; i < tiles.length; i++) {
          t = tiles[i];
          if (t.place && t.place.col !== null && t.place.row !== null) continue;
          t.place = { col: (i % perRow) * tw, row: Math.floor(i / perRow) * th, colVotes: 0, rowVotes: 0 };
        }
        pushOnce(warnings, 'some pages had no ruler numbers, so they were placed in page order');
      }

      var W = 0, H = 0;
      for (i = 0; i < tiles.length; i++) {
        t = tiles[i];
        if (t.place.col + t.gc > W) W = t.place.col + t.gc;
        if (t.place.row + t.gr > H) H = t.place.row + t.gr;
      }
      if (W < 10 || H < 10 || W * H > 4000000) {
        return fail('the grid came out an impossible size (' + W + ' × ' + H + ')', { pages: scanned });
      }

      /* Wave F (04 #3): which page printed which stitches, so the app can
         flip from a stitch to its original page. `page` is 1-based. */
      var regions = [];
      for (i = 0; i < tiles.length; i++) {
        var reg = tileRegion(tiles[i]);
        if (reg) regions.push({ page: tiles[i].page, region: reg });
      }

      /* ---- assemble ---- */
      var ids = [], idIndex = {}, counts = [];
      var raw = new Int32Array(W * H);
      var sigs = new Array(W * H);
      var graphics = { segments: [], circles: [] };
      for (i = 0; i < raw.length; i++) raw[i] = -1;
      for (i = 0; i < tiles.length; i++) {
        t = tiles[i];
        for (var y = 0; y < t.gr; y++) {
          var Y = t.place.row + y;
          if (Y < 0 || Y >= H) continue;
          for (var x = 0; x < t.gc; x++) {
            var X = t.place.col + x;
            if (X < 0 || X >= W) continue;
            var id = t.grid[y * t.gc + x];
            if (id === null) continue;
            var gi = idIndex[id];
            if (gi === undefined) { gi = ids.length; idIndex[id] = gi; ids.push(id); counts.push(0); }
            raw[Y * W + X] = gi;
            sigs[Y * W + X] = t.sig ? t.sig[y * t.gc + x] : '';
          }
        }
        tileGraphics(t, graphics);
      }
      /* counted after placing, so an overlap between tiles is counted once
         under the colour that ends up on the chart */
      for (i = 0; i < counts.length; i++) counts[i] = 0;
      var filled = 0;
      for (i = 0; i < raw.length; i++) if (raw[i] >= 0) { filled++; counts[raw[i]]++; }

      /* ---- name the colours from the key ---- */
      var key = isObj(opts.key) ? opts.key : null;
      var entries = key && Array.isArray(key.entries) ? key.entries : [];
      var marks = [];
      for (i = 0; i < ids.length; i++) marks.push({ id: ids[i], n: counts[i] });

      var cells = new Int16Array(W * H);
      var palette = null, matched = 0, agree = 0, countable = 0, ok = false, confidence = 0;

      if (!entries.length) {
        for (i = 0; i < raw.length; i++) cells[i] = raw[i] > 32000 ? -1 : raw[i];
        pushOnce(warnings, 'there is no colour key to check this grid against');
        return {
          ok: false, w: W, h: H,
          originX: tiles[0].originX, originY: tiles[0].originY,
          cellW: tiles[0].cellW, cellH: tiles[0].cellH,
          cells: cells, glyphs: ids.slice(), counts: counts.slice(), palette: null,
          colors: ids.length, matched: 0, agree: 0, confidence: 0,
          ms: Math.round(now()), pages: scanned, tiles: tiles.length,
          filled: filled, regions: regions, warnings: warnings
        };
      }

      /* Wave K: every read cell is named, split by its printed symbol when
         the key's counts prove one ink carries two colours, or put in an
         explicit "could not tell apart" class; never silently -1. */
      var sigPolys = {};
      for (i = 0; i < tiles.length; i++) {
        var sp0 = tiles[i].sigPolys || {}, spk = Object.keys(sp0);
        for (var sj = 0; sj < spk.length; sj++) if (!sigPolys[spk[sj]]) sigPolys[spk[sj]] = sp0[spk[sj]];
        tiles[i].sigPolys = null;
        tiles[i].sig = null;
      }
      var named = nameClasses(raw, sigs, ids, counts, entries, legends, sigPolys);
      var cls = named.classes;
      for (i = 0; i < raw.length; i++) cells[i] = raw[i] < 0 ? -1 : named.classPal[named.cellClass[i]];

      /* per-entry recovered counts, for the 2% acceptance test */
      var recovered = [];
      for (i = 0; i < entries.length; i++) recovered.push(0);
      for (i = 0; i < cls.length; i++) {
        if (cls[i].entry >= 0) recovered[cls[i].entry] += cls[i].n;
      }
      for (i = 0; i < ids.length; i++) if (named.inkMatched[i]) matched++;
      for (i = 0; i < entries.length; i++) {
        var want = entries[i].stitchCount;
        if (want === null || want === undefined || want <= 0) continue;
        countable++;
        if (Math.abs(recovered[i] - want) <= Math.max(2, want * 0.02)) agree++;
      }

      palette = [];
      for (i = 0; i < entries.length; i++) {
        var en = entries[i];
        var isCell = CHECK_KINDS[en.kind || 'cross'];
        var pe = normalizePaletteEntry({
          i: i, symbol: en.symbol || '', brand: en.brand || 'DMC', code: en.code,
          name: en.name || '', hex: en.hex || null,
          strands: en.strands || (key && key.strandsDefault) || 2,
          kind: en.kind || 'cross',
          /* the chart's own count for a cell colour (0 when the chart has
             none of it: the key's number lives in keyCount, so the two are
             never mixed up again); a backstitch / knot row keeps the key's */
          stitchCount: isCell ? recovered[i] : (en.stitchCount || 0),
          skeins: en.skeins || 0
        }, i, (key && key.strandsDefault) || 2);
        if (typeof en.stitchCount === 'number' && en.stitchCount > 0) pe.keyCount = en.stitchCount;
        if (named.glyphs[i]) pe.glyph = named.glyphs[i];
        palette.push(pe);
      }
      var unresolved = [];
      for (i = 0; i < named.placeholders.length; i++) {
        var ph = named.placeholders[i], cands = ph.candidates;
        var label = cands.length
          ? cands.map(function (q) { return flossLabel(entries[q]); }).join(' or ')
          : 'Unknown colour';
        var pIdx = palette.length;
        palette.push({
          i: pIdx, symbol: '', brand: '', code: '',
          name: label + (ph.why === 'unknown' ? ' (not in the key?)' : ' (not told apart)'),
          hex: /^[0-9a-f]{6}$/.test(ph.ink) ? ph.ink : '808080',
          strands: (key && key.strandsDefault) || 2, bsStrands: 1, kind: 'cross', blendWith: null,
          stitchCount: ph.n, skeins: 0, have: false, unresolved: cands.slice()
        });
        unresolved.push({
          palette: pIdx, ink: ph.ink, cells: ph.n, candidates: cands.slice(),
          expected: cands.map(function (q) { return entries[q].stitchCount || null; }),
          why: ph.why
        });
      }
      for (i = 0; i < raw.length; i++) {
        if (cells[i] < -1) cells[i] = entries.length + (-2 - cells[i]);
      }

      var agreePct = countable ? agree / countable : 0;
      ok = countable > 0 && agreePct >= 0.8 && W >= 10 && H >= 10;
      confidence = Math.round(Math.min(1, agreePct * (matched / Math.max(1, ids.length))) * 100) / 100;
      if (unresolved.length) confidence = Math.min(confidence, 0.5);

      if (matched < ids.length) {
        pushOnce(warnings, (ids.length - matched) + ' symbol' +
          (ids.length - matched === 1 ? '' : 's') + ' could not be matched to a colour in the key');
      }
      for (i = 0; i < unresolved.length; i++) {
        var ur = unresolved[i];
        pushOnce(warnings, fmtInt(ur.cells) + ' ' + plural(ur.cells, 'stitch', 'stitches') +
          (ur.why === 'unknown' ? ' are in a colour the key does not list'
            : ' could not be told apart: ' + ur.candidates.map(function (q) { return flossLabel(entries[q]); }).join(' or ')));
      }
      if (!ok) {
        pushOnce(warnings, 'the stitch counts in the key only agree with the grid on ' +
          Math.round(agreePct * 100) + '% of colours');
      }

      var checkData = normalize({ palette: palette, chart: { w: W, h: H, cells: cells } }, null);
      var check = checkCounts(checkData, entries);

      return {
        ok: ok, w: W, h: H,
        originX: tiles[0].originX, originY: tiles[0].originY,
        cellW: tiles[0].cellW, cellH: tiles[0].cellH,
        cells: cells, glyphs: ids.slice(), counts: counts.slice(), palette: palette,
        colors: ids.length, classes: cls.length, matched: matched, agree: agree, countable: countable,
        confidence: confidence, ms: Math.round(now()), pages: scanned,
        tiles: tiles.length, filled: filled, regions: regions, warnings: warnings,
        check: check, unresolved: unresolved, split: named.split,
        legend: { rows: named.legendRows, used: named.legendUsed, page: named.legendPage },
        graphics: graphics,
        mixedCells: tiles.reduce(function (s, tl) { return s + (tl.mixed || 0); }, 0)
      };
    }, function (err) {
      return fail('that PDF could not be read (' + ((err && err.message) || 'unknown error') + ')');
    });
  }

  /* ================================================================== *
   * 10c. Wave J: the key as a checksum (checkCounts) and written
   *      row-by-row instructions (writtenRows / rowText / rowDone /
   *      cellsOfRow). Pure; no state of their own.
   * ================================================================== */

  /* The key rows a cell chart can be checked against: full crosses (and
     blends, which are full crosses in two threads). Backstitch, knots,
     beads and fractionals are not cells. */
  var CHECK_KINDS = { cross: 1, blend: 1 };

  /** 'dmc|4' for DMC 04 / 4 / 'DMC 04'; '' when there is no code. */
  function codeKey(brand, code) {
    var b = String(brand == null ? '' : brand).trim().toLowerCase() || 'dmc';
    var c = String(code == null ? '' : code).trim();
    if (!c) return '';
    c = b === 'dmc' ? canonDmcCode(c) : c.toLowerCase().replace(/^0+(?=\d)/, '');
    return b + '|' + c;
  }

  /** 'DMC 310', '310' with no brand, else the name. */
  function flossLabel(e) {
    if (!e) return 'a colour';
    var code = str(e.code, '').trim(), brand = str(e.brand, '').trim();
    if (code) return (brand ? brand + ' ' : '') + code;
    return str(e.name, '').trim() || 'a colour';
  }

  function plural(n, one, many) { return n === 1 ? one : (many || one + 's'); }

  /**
   * checkCounts(data, entries) -> Check          (CONTRACT §3)
   *
   * Compares the chart's cells per palette entry with the stitch counts the
   * key printed. Palette entries are matched to key entries by brand + code
   * (DMC '04' = '4'), one to one in key order; when the chart splits one
   * floss over two palette entries, the extra ones count towards the key
   * row already matched. Only cross / blend rows are checked (see
   * CHECK_KINDS). A missing, null or zero `stitchCount` is "the key gives no
   * count": `expected: null`, `delta`/`pct`/`ok` null for that row.
   * `pct` is the signed difference as a percentage of the printed count.
   * With no `entries` array, the palette itself is listed, unchecked.
   */
  function checkCounts(data, entries) {
    data = isObj(data) ? data : {};
    var palette = Array.isArray(data.palette) ? data.palette : [];
    var grid = chartCells(data.chart);
    var noKey = !Array.isArray(entries);
    var list = noKey ? palette : entries;
    var i, k;

    /* cells per palette value */
    var perVal = {}, readTotal = 0;
    if (grid) {
      var cells = grid.cells, n = grid.w * grid.h;
      for (i = 0; i < n; i++) {
        var v = cells[i];
        if (v < 0) continue;
        readTotal++;
        perVal[v] = (perVal[v] || 0) + 1;
      }
    }

    /* the key rows that are checked, and their codes */
    var rowIdx = [], byKey = {};
    for (i = 0; i < list.length; i++) {
      var en = isObj(list[i]) ? list[i] : {};
      var kd = en.kind ? String(en.kind) : 'cross';
      if (!CHECK_KINDS[kd]) continue;
      rowIdx.push(i);
      var ck = codeKey(en.brand, en.code);
      if (ck) (byKey[ck] = byKey[ck] || []).push(i);
    }

    /* palette value -> key entry */
    var read = {}, claimed = {}, unmatchedClasses = 0, unmatchedCells = 0;
    var vals = Object.keys(perVal).map(Number).sort(function (a, b) { return a - b; });
    for (k = 0; k < vals.length; k++) {
      var pv = vals[k], cnt = perVal[pv], target = -1;
      if (noKey) {
        if (pv < list.length && CHECK_KINDS[(list[pv] && list[pv].kind) || 'cross']) target = pv;
      } else {
        var pe = palette[pv];
        var cands = pe ? byKey[codeKey(pe.brand, pe.code)] : null;
        if (cands && cands.length) {
          for (var ci = 0; ci < cands.length && target < 0; ci++) {
            if (!claimed[cands[ci]]) target = cands[ci];
          }
          if (target < 0) target = cands[0];
        }
      }
      if (target < 0) { unmatchedClasses++; unmatchedCells += cnt; continue; }
      claimed[target] = 1;
      read[target] = (read[target] || 0) + cnt;
    }

    var rows = [], unmatchedEntries = [], hasCounts = false;
    var expectedTotal = 0, accounted = 0, exact = true, allClose = true, nCounted = 0, nOk = 0;
    for (k = 0; k < rowIdx.length; k++) {
      var ei = rowIdx[k], e = isObj(list[ei]) ? list[ei] : {};
      var got = read[ei] || 0;
      var sc = noKey ? null : e.stitchCount;
      var expected = typeof sc === 'number' && isFinite(sc) && sc > 0 ? Math.round(sc) : null;
      var row = {
        entry: ei,
        code: str(e.code, ''),
        brand: str(e.brand, ''),
        name: str(e.name, '') || ((flossFor(e.brand, e.code) || {}).name || ''),
        hex: normHex(e.hex, null) || hexFor(e.brand, e.code) || null,
        read: got,
        expected: expected,
        delta: null, pct: null, ok: null
      };
      if (expected !== null) {
        hasCounts = true;
        nCounted++;
        row.delta = got - expected;
        row.pct = round1(row.delta / expected * 100);
        row.ok = Math.abs(row.delta) <= Math.max(2, expected * 0.01);
        if (row.delta !== 0) exact = false;
        if (!row.ok) allClose = false; else nOk++;
        expectedTotal += expected;
        accounted += Math.min(got, expected);
      }
      if (!got) unmatchedEntries.push(ei);
      rows.push(row);
    }
    if (!hasCounts) exact = false;

    var verdict, summary;
    var agree = hasCounts && expectedTotal > 0 ? Math.round(accounted / expectedTotal * 10000) / 10000 : 0;
    var offRows = rows.filter(function (r) { return r.ok === false; })
      .sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta) || a.entry - b.entry; });
    var nearRows = rows.filter(function (r) { return r.ok === true && r.delta !== 0; });
    var reads = function (r) {
      return flossLabel(r) + ' reads ' + fmtInt(r.read) + ' of ' + fmtInt(r.expected);
    };
    var strays = unmatchedClasses
      ? ' ' + unmatchedClasses + ' ' + plural(unmatchedClasses, 'colour') + ' in the chart (' +
        fmtInt(unmatchedCells) + ' ' + plural(unmatchedCells, 'stitch', 'stitches') + ') ' +
        (unmatchedClasses === 1 ? 'is' : 'are') + ' not in the key.'
      : '';

    if (!grid) {
      verdict = 'unchecked';
      summary = 'There is no chart to check against the key.';
    } else if (!rows.length) {
      verdict = 'unchecked';
      summary = 'There is no colour key to check this chart against (' +
        fmtInt(readTotal) + ' ' + plural(readTotal, 'stitch', 'stitches') + ' read).';
    } else if (!hasCounts) {
      verdict = 'unchecked';
      summary = 'The key prints no stitch counts, so this chart cannot be checked against it (' +
        fmtInt(readTotal) + ' ' + plural(readTotal, 'stitch', 'stitches') + ' read).';
    } else {
      /* Who the sentence is about: every colour, or only the ones the key
         prints a count for (then the rest are named at the end). */
      var some = nCounted < rows.length, single = nCounted === 1;
      var nNoCount = rows.length - nCounted;
      var who = some
        ? (single ? 'The 1 colour the key counts'
          : (nCounted === 2 ? 'Both colours the key counts' : 'All ' + nCounted + ' colours the key counts'))
        : (single ? 'The only colour' : nCounted === 2 ? 'Both colours' : 'All ' + nCounted + ' colours');
      var noCount = some
        ? '; ' + nNoCount + ' ' + plural(nNoCount, 'colour') + ' ' + plural(nNoCount, 'has', 'have') +
          ' no printed count' : '';
      var readCounted = 0;
      for (k = 0; k < rows.length; k++) if (rows[k].expected !== null) readCounted += rows[k].read;
      if (exact && !unmatchedCells) {
        verdict = 'exact';
        summary = who + (single ? ' matches' : ' match') + ' the key exactly (' + fmtInt(expectedTotal) + ' ' +
          plural(expectedTotal, 'stitch', 'stitches') + ')' + noCount + '.';
      } else if (allClose && unmatchedCells <= Math.max(2, expectedTotal * 0.01)) {
        verdict = 'close';
        summary = who + (single ? ' is' : ' are') +
          ' within a stitch or two of the key (' + fmtInt(readCounted) +
          ' of ' + fmtInt(expectedTotal) + ' stitches)' +
          (nearRows.length ? '; ' + nearRows.slice(0, 2).map(reads).join('; ') : '') + noCount + '.' + strays;
      } else {
        verdict = 'off';
        var shown = offRows.slice(0, 2).map(reads);
        if (offRows.length > 2) shown.push('and ' + (offRows.length - 2) + ' more ' + plural(offRows.length - 2, 'is', 'are') + ' off');
        var head = single
          ? (some ? 'The 1 colour the key counts' : 'The only colour') + (nOk ? ' matches' : ' does not match')
          : nOk + ' of ' + nCounted + ' ' + (some ? 'colours the key counts' : 'colours') + ' match';
        summary = head + (shown.length ? '; ' + shown.join('; ') : '') + noCount + '.' + strays;
      }
    }

    return {
      hasCounts: hasCounts,
      rows: rows,
      unmatchedEntries: unmatchedEntries,
      unmatchedClasses: unmatchedClasses,
      readTotal: readTotal,
      expectedTotal: hasCounts ? expectedTotal : null,
      exact: exact,
      agree: agree,
      verdict: verdict,
      summary: summary
    };
  }

  /* ---- written instructions --------------------------------------- */

  /* The last chart unpacked, so a sheet that asks rowDone() for every row
     does not unpack the RLE once per row. Keyed by the packed string. */
  var ROW_CACHE = { key: null, w: 0, h: 0, grid: null };
  var DONE_CACHE = { key: null, bytes: null };

  function gridOf(data) {
    var chart = isObj(data) && isObj(data.chart) ? data.chart : null;
    if (!chart) return null;
    var cells = chart.cells;
    var key = typeof cells === 'string' ? cells
      : (isObj(cells) && typeof cells.data === 'string' ? cells.data : null);
    if (key !== null && ROW_CACHE.key === key && ROW_CACHE.w === chart.w && ROW_CACHE.h === chart.h) {
      return ROW_CACHE.grid;
    }
    var g = chartCells(chart);
    if (g && key !== null) { ROW_CACHE.key = key; ROW_CACHE.w = chart.w; ROW_CACHE.h = chart.h; ROW_CACHE.grid = g; }
    return g;
  }

  /** The crosses' progress bitmap as bytes (the same bits progressStats reads). */
  function doneBytes(data) {
    var pr = isObj(data) && isObj(data.progress) ? data.progress : null;
    if (!pr || pr.mode === 'counts') return null;
    var s = str(pr.done, '');
    if (DONE_CACHE.key === s) return DONE_CACHE.bytes;
    var b = b64ToBytes(s);
    DONE_CACHE.key = s; DONE_CACHE.bytes = b;
    return b;
  }

  function colorOpt(opts) {
    var c = isObj(opts) ? opts.color : null;
    return typeof c === 'number' && isFinite(c) && c >= 0 ? Math.floor(c) : null;
  }

  /**
   * writtenRows(data, opts) -> { w, h, from, dir, color, rows, totals }   (CONTRACT §2)
   *
   * rows[k] = { y, n, rtl, stitches, runs: [{ p, n, x }] }
   *  - `n` is the row's label in the chosen order over the WHOLE chart
   *    (row 1 = top row, or bottom row with from:'bottom'), so labels stay
   *    put when yFrom/yTo or skipEmpty leave rows out.
   *  - serpentine: odd-numbered rows go left to right, even ones right to
   *    left (`rtl`), by that label, so the direction never depends on which
   *    rows are listed.
   *  - runs are in working order and cover the whole row; `p` -1 is "skip"
   *    (unstitched, or another colour in a one-colour pass). `x` is in chart
   *    space: the column the run STARTS at as worked, so in an rtl row it
   *    is the run's rightmost column and the run covers x, x-1, … x-n+1.
   *  - yFrom / yTo: 0-based chart rows, inclusive, clamped.
   *  - totals: rows listed, stitches in them, and empty rows in the range
   *    (counted whether or not skipEmpty dropped them).
   */
  function writtenRows(data, opts) {
    opts = isObj(opts) ? opts : {};
    var from = opts.from === 'bottom' ? 'bottom' : 'top';
    var dir = opts.dir === 'serpentine' ? 'serpentine' : 'ltr';
    var color = colorOpt(opts);
    var g = gridOf(data);
    var out = { w: g ? g.w : 0, h: g ? g.h : 0, from: from, dir: dir, color: color,
      rows: [], totals: { rows: 0, stitches: 0, emptyRows: 0 } };
    if (!g) return out;
    var w = g.w, h = g.h, cells = g.cells;
    var y0 = clampInt(opts.yFrom, 0, h - 1, 0), y1 = clampInt(opts.yTo, 0, h - 1, h - 1);
    if (y0 > y1) { var tmp = y0; y0 = y1; y1 = tmp; }
    /* Wave K (#14): a column band, a printed page or a 10 x 10 block, long
       rows chunked at every `chunk` columns, and the done squares per run. */
    var xa = clampInt(opts.xFrom, 0, w - 1, 0), xb = clampInt(opts.xTo, 0, w - 1, w - 1);
    if (xa > xb) { var tx = xa; xa = xb; xb = tx; }
    var sc = isObj(opts.scope) ? opts.scope : null;
    if (sc) {
      var sr = scopeRect(data, sc, w, h);
      if (!sr || sr.x1 < sr.x0) return out;
      xa = Math.max(xa, sr.x0); xb = Math.min(xb, sr.x1);
      y0 = Math.max(y0, sr.y0); y1 = Math.min(y1, sr.y1);
      if (xa > xb || y0 > y1) return out;
      out.scope = { x0: xa, y0: y0, x1: xb, y1: y1, label: sr.words.join(' · ') };
    }
    var chunk = clampInt(opts.chunk, 0, 10000, 0);
    var withDone = !!opts.done, dbytes = withDone ? doneOf(data, w * h) : null;
    var bandW = xb - xa + 1;
    var count = y1 - y0 + 1;
    for (var k = 0; k < count; k++) {
      var y = from === 'top' ? y0 + k : y1 - k;
      var label = from === 'top' ? y + 1 : h - y;
      var rtl = dir === 'serpentine' && label % 2 === 0;
      var base = y * w, runs = [], stitches = 0;
      var curP = -2, curN = 0, curX = 0, curD = 0;
      for (var s = 0; s < bandW; s++) {
        var x = rtl ? xb - s : xa + s;
        var v = cells[base + x];
        var p = v < 0 || (color !== null && v !== color) ? -1 : v;
        if (p >= 0) stitches++;
        var brk = chunk && s && (rtl ? (x + 1) % chunk === 0 : x % chunk === 0);
        var on = withDone && p >= 0 ? bitOn(dbytes, base + x) : 0;
        if (p === curP && !brk) { curN++; curD += on; continue; }
        if (curN) runs.push(withDone ? { p: curP, n: curN, x: curX, done: curD } : { p: curP, n: curN, x: curX });
        curP = p; curN = 1; curX = x; curD = on;
      }
      if (curN) runs.push(withDone ? { p: curP, n: curN, x: curX, done: curD } : { p: curP, n: curN, x: curX });
      if (!stitches) out.totals.emptyRows++;
      if (!stitches && opts.skipEmpty) continue;
      out.rows.push({ y: y, n: label, rtl: rtl, stitches: stitches, runs: runs });
      out.totals.stitches += stitches;
    }
    out.totals.rows = out.rows.length;
    return out;
  }

  /** How a colour is named in the written text. */
  function runColourName(palette, p, names) {
    var e = palette[p];
    if (!isObj(e)) return 'colour ' + (p + 1);
    var label = flossLabel(e);
    if (names === 'symbol') return str(e.symbol, '') || label;
    if (names === 'code+name') {
      var nm = str(e.name, '').trim();
      return str(e.code, '').trim() && nm ? label + ' ' + nm : label;
    }
    return label;
  }

  /**
   * rowText(row, data, opts) -> 'Row 12 (left to right): skip 3, 5 × DMC 310, 1 DMC 842'
   *
   * opts.names: 'code' (default) | 'code+name' | 'symbol' (falls back to the
   * code when an entry has no symbol). Leading skips are kept: they place
   * the first stitch. Trailing skips are left off the text (there is
   * nothing after them to place; they are still in row.runs) unless
   * opts.trailing is true. A run of one reads '1 DMC 310', not '1 × …'.
   * A row with nothing to stitch says so.
   */
  function rowText(row, data, opts) {
    opts = isObj(opts) ? opts : {};
    row = isObj(row) ? row : {};
    var names = opts.names === 'code+name' || opts.names === 'symbol' ? opts.names : 'code';
    var palette = isObj(data) && Array.isArray(data.palette) ? data.palette : [];
    var head = 'Row ' + (row.n === undefined ? (num(row.y, 0) + 1) : row.n) +
      ' (' + (row.rtl ? 'right to left' : 'left to right') + ')';
    var runs = Array.isArray(row.runs) ? row.runs : [];
    var end = runs.length;
    if (!opts.trailing) while (end > 0 && !(runs[end - 1].p >= 0)) end--;
    var any = false, parts = [];
    for (var i = 0; i < end; i++) {
      var r = runs[i], n = clampInt(r.n, 0, 1e6, 0);
      if (!n) continue;
      if (!(r.p >= 0)) { parts.push('skip ' + n); continue; }
      any = true;
      parts.push((n === 1 ? '1 ' : n + ' × ') + runColourName(palette, r.p, names));
    }
    if (!any) return head + ': nothing to stitch';
    return head + ': ' + parts.join(', ');
  }

  /**
   * cellsOfRow(data, y, opts) -> number[]
   * The cell indices (y * w + x, ascending) a "row done" tap marks: every
   * stitched cell of chart row y, or only those of opts.color.
   */
  function cellsOfRow(data, y, opts) {
    var g = gridOf(data);
    if (!g) return [];
    y = clampInt(y, -1, 1e6, -1);
    if (y < 0 || y >= g.h) return [];
    var color = colorOpt(opts), out = [], base = y * g.w;
    for (var x = 0; x < g.w; x++) {
      var v = g.cells[base + x];
      if (v < 0 || (color !== null && v !== color)) continue;
      out.push(base + x);
    }
    return out;
  }

  /**
   * rowDone(data, y, opts) -> boolean
   * Every stitched cell of row y (of opts.color, when given) is marked in
   * the crosses' progress bitmap (data.progress.done). A row with nothing
   * to stitch is done. No chart, a row off the chart, or a counts-mode
   * project: false.
   */
  function rowDone(data, y, opts) {
    var g = gridOf(data);
    if (!g) return false;
    y = clampInt(y, -1, 1e6, -1);
    if (y < 0 || y >= g.h) return false;
    var color = colorOpt(opts), base = y * g.w;
    var bytes = doneBytes(data);
    for (var x = 0; x < g.w; x++) {
      var v = g.cells[base + x];
      if (v < 0 || (color !== null && v !== color)) continue;
      var i = base + x;
      if (!bytes || !(((bytes[i >> 3] || 0) >> (i & 7)) & 1)) return false;
    }
    return true;
  }

  /* ================================================================== *
   * 10d. Wave K (xs-core). Pure logic for the batch-2 app: placeholders a
   *      grid read could not name, one total, distinct symbols, skeins to
   *      buy, bulk marks with a confirm, parking, pages, islands, rows v2,
   *      find my place, goals, sessions and pace, stash and brands,
   *      calculators, joining charts, cells off localStorage, grid-craft
   *      kinds, and the mark log. See docs/wave-k/api/xs-core.md.
   * ================================================================== */

  function nowMs(now) { return typeof now === 'number' && isFinite(now) ? now : Date.now(); }

  /** A fresh, mutable copy of the chart's cells (never the shared cache). */
  function cellsCopy(data) {
    var g = chartCells(isObj(data) ? data.chart : null);
    if (!g) return null;
    var c = new Int16Array(g.w * g.h);
    for (var i = 0; i < c.length; i++) c[i] = i < g.cells.length ? g.cells[i] : -1;
    return { w: g.w, h: g.h, cells: c };
  }

  /** The progress bitmap of the crosses as bytes, or an empty one. */
  function doneOf(data, n) {
    var pr = isObj(data) && isObj(data.progress) ? data.progress : {};
    if (pr.mode === 'counts') return new Uint8Array(Math.ceil(n / 8));
    var b = b64ToBytes(str(pr.done, ''));
    if (b.length < Math.ceil(n / 8)) { var g = new Uint8Array(Math.ceil(n / 8)); g.set(b); b = g; }
    return b;
  }
  function bitOn(bytes, i) { return ((bytes[i >> 3] || 0) >> (i & 7)) & 1; }

  /**
   * Moves every reference to palette entry `from` onto `to` (-1: unstitched)
   * and then removes `from`, renumbering everything above it.
   */
  function mergePaletteEntry(d, from, to) {
    var g = cellsCopy(d), i;
    var toAfter = to > from ? to - 1 : to;
    var shift = function (v) { return v === from ? toAfter : (v > from ? v - 1 : v); };
    if (g) {
      for (i = 0; i < g.cells.length; i++) {
        var v = g.cells[i];
        if (v === from) g.cells[i] = toAfter;
        else if (v > from) g.cells[i] = v - 1;
      }
      d.chart.cells = packCells(g.cells, g.w, g.h);
      ['part', 'back', 'knots'].forEach(function (layer) {
        var list = d.chart[layer] || [];
        for (var k = 0; k < list.length; k++) {
          if (layer === 'part') {
            if (list[k].a >= 0) list[k].a = list[k].a === from ? toAfter : (list[k].a > from ? list[k].a - 1 : list[k].a);
            if (list[k].b >= 0) list[k].b = list[k].b === from ? toAfter : (list[k].b > from ? list[k].b - 1 : list[k].b);
          } else if (list[k].i >= 0) {
            list[k].i = list[k].i === from ? toAfter : (list[k].i > from ? list[k].i - 1 : list[k].i);
          }
        }
      });
    }
    d.palette.splice(from, 1);
    for (i = 0; i < d.palette.length; i++) {
      d.palette[i].i = i;
      if (d.palette[i].blendWith !== null && d.palette[i].blendWith !== undefined) {
        var bw = shift(d.palette[i].blendWith);
        d.palette[i].blendWith = bw < 0 ? null : bw;
      }
    }
    if (Array.isArray(d.parking)) {
      for (i = 0; i < d.parking.length; i++) {
        var pk = d.parking[i];
        if (typeof pk.paletteIndex === 'number') pk.paletteIndex = Math.max(0, pk.paletteIndex === from ? toAfter : (pk.paletteIndex > from ? pk.paletteIndex - 1 : pk.paletteIndex));
      }
    }
    if (d.current) {
      if (d.current.paletteIndex === from) d.current.paletteIndex = Math.max(0, toAfter);
      else if (d.current.paletteIndex > from) d.current.paletteIndex--;
      if (d.current.rowOpts && typeof d.current.rowOpts.color === 'number') {
        var rc = d.current.rowOpts.color;
        d.current.rowOpts.color = rc === from ? (toAfter >= 0 ? toAfter : null) : (rc > from ? rc - 1 : rc);
      }
    }
    if (d.progress && Array.isArray(d.progress.perColor)) {
      d.progress.perColor = d.progress.perColor.filter(function (p) { return p.i !== from; })
        .map(function (p) { return { i: p.i > from ? p.i - 1 : p.i, done: p.done }; });
    }
    return d;
  }

  /**
   * resolveClass(data, placeholder, choice) -> data      (parity gap 1)
   *
   * The stitcher's answer for a placeholder colour a grid read could not
   * name (`palette[placeholder].unresolved`):
   *   choice = palette index    every square of the placeholder becomes it
   *   choice = -1               "these squares are fabric" (unstitched)
   *   choice = { cells:[idx], to }   only those squares (a split by hand)
   * The placeholder is removed once no square uses it, and every index above
   * it moves down one. Done bits stay with their squares. Pure: returns a new
   * normalized XSData; the caller wraps it in Store.updateCraftData (undo).
   */
  function resolveClass(data, placeholder, choice) {
    var d = normalize(deepCopy(normalize(data, null)), null);
    var p = clampInt(placeholder, 0, 9999, -1);
    if (p < 0 || p >= d.palette.length || !d.chart) return d;
    var g = cellsCopy(d), i;
    if (isObj(choice)) {
      var to = clampInt(choice.to, -1, d.palette.length - 1, -2);
      if (to === -2 || to === p) return d;
      var list = Array.isArray(choice.cells) ? choice.cells : [];
      for (i = 0; i < list.length; i++) {
        var ci = clampInt(list[i], 0, g.cells.length - 1, -1);
        if (ci >= 0 && g.cells[ci] === p) g.cells[ci] = to;
      }
      d.chart.cells = packCells(g.cells, g.w, g.h);
      var left = 0;
      for (i = 0; i < g.cells.length; i++) if (g.cells[i] === p) left++;
      d.palette[p].stitchCount = left;
      if (left) return normalize(d, null);
      return normalize(mergePaletteEntry(d, p, -1), null);
    }
    var target = clampInt(choice, -1, d.palette.length - 1, -2);
    if (target === -2 || target === p) return d;
    var moved = 0;
    for (i = 0; i < g.cells.length; i++) if (g.cells[i] === p) moved++;
    if (target >= 0) d.palette[target].stitchCount = (d.palette[target].stitchCount || 0) + moved;
    return normalize(mergePaletteEntry(d, p, target), null);
  }

  /* ---- #1 the honesty sweep: one total, said one way ------------------ */

  /** pctText(412, 64512) -> '0.64%'; under 1% two decimals, never '100%' early. */
  function pctText(done, total) {
    done = num(done, 0); total = num(total, 0);
    if (!(total > 0) || !(done > 0)) return '0%';
    if (done >= total) return '100%';
    var p = done / total * 100;
    if (p < 0.01) return '<0.01%';
    if (p < 1) return String(Math.round(p * 100) / 100) + '%';
    var r = Math.floor(p);
    return (r >= 100 ? 99 : r) + '%';
  }

  /**
   * totals(data) -> { done, total, pct, pctText, crosses:{done,total}, fromKey:[i], text }
   * THE stitch total. progressStats over the chart, plus any cross colour the
   * chart holds no square of but the key prints a count for (keyCount):
   * those are counted from the key ("counted from the key, not on the
   * chart"), their done from progress.keyDone. Every screen shows this one.
   */
  function totals(data) {
    var d = isObj(data) ? data : {};
    var st = progressStats(d);
    var palette = Array.isArray(d.palette) ? d.palette : [];
    var fromKey = [], extraT = 0, extraD = 0;
    var kd = isObj(d.progress) && isObj(d.progress.keyDone) ? d.progress.keyDone : {};
    if (isObj(d.progress) && d.progress.mode === 'cells') {
      for (var i = 0; i < palette.length; i++) {
        var e = palette[i];
        if (!CHECK_KINDS[e.kind || 'cross'] || !(e.keyCount > 0) || e.unresolved) continue;
        if (st.byColor[i] && st.byColor[i].total > 0) continue;
        fromKey.push(i);
        extraT += e.keyCount;
        extraD += Math.min(e.keyCount, clampInt(kd[i], 0, 1e9, 0));
      }
    }
    var done = st.done + extraD, total = st.total + extraT;
    return {
      done: done, total: total,
      pct: total > 0 ? Math.floor(done / total * 100) : 0,
      pctText: pctText(done, total),
      crosses: { done: st.breakdown.cross.done + extraD, total: st.breakdown.cross.total + extraT },
      fromKey: fromKey,
      text: fmtInt(done) + ' of ' + fmtInt(total) + ' ' + plural(total, 'stitch', 'stitches') + ' · ' + pctText(done, total)
    };
  }

  /* family rotation for distinct symbols */
  var FAMILY_ORDER = ['dot', 'square', 'tri', 'round', 'cross', 'diamond', 'line', 'star', 'angle', 'letter', 'digit', 'alpha'];

  /**
   * symbolCheck(palette) -> { ok, repeats:[[i,j]], sameFamily:[[i,j]] }
   * repeats: two colours with the same symbol. sameFamily: two colours whose
   * symbols are from one shape family while some family is still unused.
   */
  function symbolCheck(palette) {
    var list = Array.isArray(palette) ? palette : [];
    var repeats = [], same = [], fams = {}, i, j;
    for (i = 0; i < list.length; i++) fams[familyOf(str(list[i] && list[i].symbol, ''))] = 1;
    var spare = Object.keys(fams).length < FAMILY_ORDER.length && list.length <= FAMILY_ORDER.length;
    for (i = 0; i < list.length; i++) {
      for (j = i + 1; j < list.length; j++) {
        var a = str(list[i] && list[i].symbol, ''), b = str(list[j] && list[j].symbol, '');
        if (!a || !b) continue;
        if (a === b) repeats.push([i, j]);
        else if (spare && familyOf(a) === familyOf(b)) same.push([i, j]);
      }
    }
    return { ok: !repeats.length && !same.length, repeats: repeats, sameFamily: same };
  }

  /* ---- skeins to buy ---------------------------------------------------- */

  /**
   * skeinPlan({ stitchCount, count, over, strands, waste, have }) ->
   *   { low, mid, high, have, buy, text }
   * mid uses the geometric middle of the published yields, so "buy" is a
   * number a stitcher can act on, with the range still shown.
   */
  function skeinPlan(o) {
    o = isObj(o) ? o : {};
    var r = skeinRange(o), have = clampInt(o.have, 0, 9999, 0);
    var buy = Math.max(0, r.mid - have);
    var text;
    if (!r.high) text = 'no stitches, no skeins';
    else {
      text = (r.low === r.high ? r.high + ' ' + plural(r.high, 'skein') : r.low + '–' + r.high + ' skeins');
      if (have) text += ' (you have ' + have + (buy ? ', buy ' + buy : ', enough') + ')';
      else if (r.low !== r.high) text += ' (buy ' + r.mid + ')';
    }
    return { low: r.low, mid: r.mid, high: r.high, have: have, buy: buy, text: text };
  }

  /* ---- bulk marks, described before they happen ------------------------ */

  var CONFIRM_ABOVE = 1000;

  function scopeRect(d, scope, w, h) {
    var r = { x0: 0, y0: 0, x1: w - 1, y1: h - 1 }, words = [];
    if (isObj(scope.block)) {
      var bx = clampInt(scope.block.bx, 0, 9999, 0), by = clampInt(scope.block.by, 0, 9999, 0);
      r = { x0: bx * 10, y0: by * 10, x1: Math.min(w - 1, bx * 10 + 9), y1: Math.min(h - 1, by * 10 + 9) };
      words.push('block ' + (bx + 1) + ',' + (by + 1));
    }
    if (scope.page !== undefined && scope.page !== null) {
      var pg = Array.isArray(d.pages) ? d.pages[clampInt(scope.page, 0, 9999, -1)] : null;
      if (!pg || !pg.region) return null;
      var q = pg.region;
      r = { x0: Math.max(r.x0, q.x), y0: Math.max(r.y0, q.y), x1: Math.min(r.x1, q.x + q.w - 1), y1: Math.min(r.y1, q.y + q.h - 1) };
      words.push(str(pg.label, 'page ' + (clampInt(scope.page, 0, 9999, 0) + 1)).replace(/^Page/, 'page'));
    }
    if (scope.row !== undefined && scope.row !== null) {
      var ry = clampInt(scope.row, 0, h - 1, 0);
      r = { x0: r.x0, y0: Math.max(r.y0, ry), x1: r.x1, y1: Math.min(r.y1, ry) };
      words.push('row ' + (ry + 1));
    }
    if (r.x1 < r.x0 || r.y1 < r.y0) r = { x0: 0, y0: 0, x1: -1, y1: -1 };
    r.words = words;
    return r;
  }

  /**
   * bulkPlan(data, scope, opts) -> { cells:Int32Array, count, already, total, confirm, text, label }
   * What a "whole colour" / "page done" / "block done" / "row done" tap
   * would change, so the app can ask first. scope: { color } | { page } |
   * { page, color } | { block:{bx,by} } | { block, color } | { row, color }.
   * opts.unmark: describe un-marking instead. `cells` are the squares whose
   * bit would flip; `confirm` is true above CONFIRM_ABOVE of them.
   */
  function bulkPlan(data, scope, opts) {
    opts = isObj(opts) ? opts : {};
    scope = isObj(scope) ? scope : {};
    var none = { cells: new Int32Array(0), count: 0, already: 0, total: 0, confirm: false, text: 'Nothing to mark.', label: '' };
    var g = gridOf(data);
    if (!g) return none;
    var w = g.w, h = g.h, cells = g.cells;
    var color = typeof scope.color === 'number' && scope.color >= 0 ? Math.floor(scope.color) : null;
    var rect = scopeRect(data, scope, w, h);
    if (!rect) return none;
    var bytes = doneOf(data, w * h), unmark = !!opts.unmark;
    var pick = [], total = 0, already = 0;
    for (var y = rect.y0; y <= rect.y1; y++) {
      for (var x = rect.x0; x <= rect.x1; x++) {
        var i = y * w + x, v = cells[i];
        if (v < 0 || (color !== null && v !== color)) continue;
        total++;
        var on = bitOn(bytes, i);
        if (on) already++;
        if (on === (unmark ? 1 : 0)) pick.push(i);
      }
    }
    var e = color !== null && Array.isArray(data.palette) ? data.palette[color] : null;
    var label = [e ? flossLabel(e) : ''].concat(rect.words).filter(Boolean).join(' · ') || 'the whole chart';
    var n = pick.length;
    var text = n
      ? (unmark ? 'Unmark ' : 'Mark ') + fmtInt(n) + ' ' + plural(n, 'stitch', 'stitches') + ' of ' + label +
        (unmark ? '?' : ' as done?') + (already && !unmark ? ' (' + fmtInt(already) + ' already done)' : '')
      : (unmark ? 'Nothing marked in ' : 'All of ') + label + (unmark ? '.' : ' is already done.');
    return { cells: new Int32Array(pick), count: n, already: already, total: total,
      confirm: n > CONFIRM_ABOVE, text: text, label: label };
  }

  /* ---- #3 parking on the chart ------------------------------------------ */

  var CORNERS = { tl: 1, tr: 1, bl: 1, br: 1 };

  /**
   * parkAt(data, { x, y, paletteIndex, corner, note }) -> data
   * Parks a colour's thread at stitch (x, y); a thread already parked on
   * that stitch in that colour is moved, not doubled.
   */
  function parkAt(data, o) {
    var d = normalize(deepCopy(normalize(data, null)), null);
    o = isObj(o) ? o : {};
    if (!d.chart) return d;
    var x = clampInt(o.x, 0, d.chart.w - 1, -1), y = clampInt(o.y, 0, d.chart.h - 1, -1);
    var pi = clampInt(o.paletteIndex, 0, Math.max(0, d.palette.length - 1), -1);
    if (x < 0 || y < 0 || pi < 0 || pi >= d.palette.length) return d;
    var e = d.palette[pi];
    var entry = { key: flossLabel(e), symbol: e.symbol || '', corner: CORNERS[o.corner] ? o.corner : 'tl',
      note: str(o.note, '').slice(0, 200), x: x, y: y, paletteIndex: pi };
    for (var i = 0; i < d.parking.length; i++) {
      var p = d.parking[i];
      if (p.x === x && p.y === y && p.paletteIndex === pi) { d.parking[i] = entry; return normalize(d, null); }
    }
    d.parking.push(entry);
    return normalize(d, null);
  }

  /** unpark(data, i) -> data without parking[i]. */
  function unpark(data, i) {
    var d = normalize(deepCopy(normalize(data, null)), null);
    i = clampInt(i, 0, 9999, -1);
    if (i >= 0 && i < d.parking.length) d.parking.splice(i, 1);
    return d;
  }

  /** parkedAt(data, x, y) -> [parking index] (marking a parked stitch offers to unpark). */
  function parkedAt(data, x, y) {
    var out = [], list = isObj(data) && Array.isArray(data.parking) ? data.parking : [];
    for (var i = 0; i < list.length; i++) if (list[i].x === x && list[i].y === y) out.push(i);
    return out;
  }

  /** Block order for a parking direction: rank of block (bx, by) after (fx, fy). */
  function blockRank(bx, by, fx, fy, nbx, nby, dir) {
    var lin, cur;
    if (dir === 'down' || dir === 'column') { lin = bx * nby + by; cur = fx * nby + fy; }
    else if (dir === 'left') { lin = by * nbx + (nbx - 1 - bx); cur = fy * nbx + (nbx - 1 - fx); }
    else { lin = by * nbx + bx; cur = fy * nbx + fx; }
    var total = nbx * nby;
    return ((lin - cur) % total + total) % total;      // 0 = the current block
  }

  /** Per 10 x 10 block, the squares of `color` still to do (and the first one). */
  function blockTodo(g, color, bytes) {
    var nbx = Math.ceil(g.w / 10), nby = Math.ceil(g.h / 10);
    var left = new Int32Array(nbx * nby), first = new Int32Array(nbx * nby);
    for (var i = 0; i < first.length; i++) first[i] = -1;
    for (var y = 0; y < g.h; y++) {
      var by = (y / 10) | 0;
      for (var x = 0; x < g.w; x++) {
        var c = y * g.w + x;
        if (g.cells[c] !== color || bitOn(bytes, c)) continue;
        var b = by * nbx + ((x / 10) | 0);
        left[b]++;
        if (first[b] < 0) first[b] = c;
      }
    }
    return { nbx: nbx, nby: nby, left: left, first: first };
  }

  /**
   * nextBlockFor(data, color, from:{x,y}, dir) -> { x, y, bx, by, left } | null
   * The parking assistant: the next 10 x 10 block, in the stitcher's working
   * direction ('right' rows of blocks left to right, 'left', 'down' /
   * 'column' columns of blocks top to bottom), that still has stitches of
   * this colour to do, and the first of them (where to park the thread).
   * Wraps round the chart; never returns the current block.
   */
  function nextBlockFor(data, color, from, dir) {
    var g = gridOf(data);
    if (!g) return null;
    color = clampInt(color, 0, 9999, -1);
    from = isObj(from) ? from : {};
    var fx = clampInt(from.x, 0, g.w - 1, 0), fy = clampInt(from.y, 0, g.h - 1, 0);
    var t = blockTodo(g, color, doneOf(data, g.w * g.h));
    var fbx = (fx / 10) | 0, fby = (fy / 10) | 0, best = -1, bestRank = Infinity;
    for (var b = 0; b < t.left.length; b++) {
      if (!t.left[b]) continue;
      var bx = b % t.nbx, by = (b / t.nbx) | 0;
      var rk = blockRank(bx, by, fbx, fby, t.nbx, t.nby, dir);
      if (rk === 0) continue;
      if (rk < bestRank) { bestRank = rk; best = b; }
    }
    if (best < 0) return null;
    var c = t.first[best];
    return { x: c % g.w, y: (c / g.w) | 0, bx: best % t.nbx, by: (best / t.nbx) | 0, left: t.left[best] };
  }

  /**
   * parkingOrder(data, from, dir) -> [{ i, x, y, paletteIndex, rank, distance }]
   * The parked threads in the order the stitcher will meet them.
   */
  function parkingOrder(data, from, dir) {
    var g = gridOf(data), list = isObj(data) && Array.isArray(data.parking) ? data.parking : [];
    if (!g) return [];
    from = isObj(from) ? from : {};
    var fx = clampInt(from.x, 0, g.w - 1, 0), fy = clampInt(from.y, 0, g.h - 1, 0);
    var nbx = Math.ceil(g.w / 10), nby = Math.ceil(g.h / 10), out = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (typeof p.x !== 'number' || typeof p.y !== 'number') continue;
      out.push({ i: i, x: p.x, y: p.y, paletteIndex: p.paletteIndex === undefined ? null : p.paletteIndex,
        rank: blockRank((p.x / 10) | 0, (p.y / 10) | 0, (fx / 10) | 0, (fy / 10) | 0, nbx, nby, dir),
        distance: Math.round(Math.sqrt((p.x - fx) * (p.x - fx) + (p.y - fy) * (p.y - fy)) * 10) / 10 });
    }
    out.sort(function (a, b) { return a.rank - b.rank || a.distance - b.distance || a.i - b.i; });
    return out;
  }

  /* ---- #4 printed pages as regions ------------------------------------- */

  /**
   * cellsOfPage(data, pageIndex, { color }) -> Int32Array of the stitched
   * squares (ascending) that printed page prints; empty when the page has
   * no region.
   */
  function cellsOfPage(data, pageIndex, opts) {
    var g = gridOf(data), pg = isObj(data) && Array.isArray(data.pages) ? data.pages[clampInt(pageIndex, 0, 9999, -1)] : null;
    if (!g || !pg || !pg.region) return new Int32Array(0);
    var color = colorOpt(opts), r = pg.region, out = [];
    for (var y = r.y; y < r.y + r.h && y < g.h; y++) {
      for (var x = r.x; x < r.x + r.w && x < g.w; x++) {
        var i = y * g.w + x, v = g.cells[i];
        if (v < 0 || (color !== null && v !== color)) continue;
        out.push(i);
      }
    }
    return new Int32Array(out);
  }

  /**
   * pageProgress(data) -> [{ page, n, label, region, done, total, pct, pctText, complete }]
   * One row per page that prints part of the chart, its progress read off
   * the same bitmap as everything else ("Page 9 · 1,204 of 4,081 done").
   */
  function pageProgress(data) {
    var g = gridOf(data), pages = isObj(data) && Array.isArray(data.pages) ? data.pages : [];
    if (!g) return [];
    var bytes = doneOf(data, g.w * g.h), out = [];
    for (var p = 0; p < pages.length; p++) {
      var r = pages[p] && pages[p].region;
      if (!r) continue;
      var done = 0, total = 0;
      for (var y = r.y; y < r.y + r.h && y < g.h; y++) {
        for (var x = r.x; x < r.x + r.w && x < g.w; x++) {
          var i = y * g.w + x;
          if (g.cells[i] < 0) continue;
          total++;
          if (bitOn(bytes, i)) done++;
        }
      }
      out.push({ page: p, n: pages[p].n, label: pages[p].label, region: r, done: done, total: total,
        pct: total ? Math.floor(done / total * 100) : 0, pctText: pctText(done, total),
        complete: total > 0 && done === total });
    }
    return out;
  }

  /* ---- #13 islands and travel ------------------------------------------ */

  var ISLAND_CACHE = { key: null, color: null, res: null };

  /**
   * islands(data, color) -> { count, list:[{ id, n, done, x0, y0, x1, y1, first }], label:Int32Array }
   * 8-connected areas of one colour (a stitcher can carry along a diagonal),
   * numbered in reading order of their first square. label[i] is the island
   * of square i, -1 elsewhere. The last answer is cached.
   */
  function islands(data, color) {
    var g = gridOf(data);
    color = clampInt(color, 0, 9999, -1);
    if (!g || color < 0) return { count: 0, list: [], label: new Int32Array(0) };
    var ck = (isObj(data.chart) && (typeof data.chart.cells === 'string' ? data.chart.cells : (data.chart.cells && data.chart.cells.data))) || null;
    var dk = isObj(data.progress) ? str(data.progress.done, '') : '';
    if (ck && ISLAND_CACHE.key === ck + '#' + dk.length + dk.slice(0, 64) && ISLAND_CACHE.color === color) return ISLAND_CACHE.res;
    var w = g.w, h = g.h, cells = g.cells, label = new Int32Array(w * h), i;
    for (i = 0; i < label.length; i++) label[i] = -1;
    var bytes = doneOf(data, w * h), list = [], stack = new Int32Array(w * h);
    for (i = 0; i < cells.length; i++) {
      if (cells[i] !== color || label[i] >= 0) continue;
      var id = list.length, sp = 0, isl = { id: id, n: 0, done: 0, x0: w, y0: h, x1: -1, y1: -1, first: i };
      stack[sp++] = i; label[i] = id;
      while (sp) {
        var c = stack[--sp], cx = c % w, cy = (c / w) | 0;
        isl.n++;
        if (bitOn(bytes, c)) isl.done++;
        if (cx < isl.x0) isl.x0 = cx;
        if (cx > isl.x1) isl.x1 = cx;
        if (cy < isl.y0) isl.y0 = cy;
        if (cy > isl.y1) isl.y1 = cy;
        for (var dy = -1; dy <= 1; dy++) {
          var ny = cy + dy;
          if (ny < 0 || ny >= h) continue;
          for (var dx = -1; dx <= 1; dx++) {
            var nx = cx + dx;
            if ((!dx && !dy) || nx < 0 || nx >= w) continue;
            var nc = ny * w + nx;
            if (cells[nc] === color && label[nc] < 0) { label[nc] = id; stack[sp++] = nc; }
          }
        }
      }
      list.push(isl);
    }
    var res = { count: list.length, list: list, label: label };
    if (ck) { ISLAND_CACHE.key = ck + '#' + dk.length + dk.slice(0, 64); ISLAND_CACHE.color = color; ISLAND_CACHE.res = res; }
    return res;
  }

  /** Cells per centimetre on this project's fabric (stitches, not threads). */
  function cellsPerCm(data) {
    var f = isObj(data) && isObj(data.fabric) ? data.fabric : {};
    return effectiveCount(f.count, f.over) / CM_PER_IN;
  }

  /**
   * Nearest square of another island (not in `skip`), searched outwards from
   * every square of island `id` at once. -> { island, from, to, cells } | null
   */
  function nearestIsland(isl, w, h, id, skip, stamp, stampVal) {
    var label = isl.label, queue = [], src = [], i, head = 0;
    var first = isl.list[id].first;
    /* seed with the island's squares (flood its label from `first`) */
    var seed = [first];
    stamp[first] = stampVal;
    while (seed.length) {
      var c = seed.pop();
      queue.push(c); src.push(c);
      var cx = c % w, cy = (c / w) | 0;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        var n2 = ny * w + nx;
        if (label[n2] === id && stamp[n2] !== stampVal) { stamp[n2] = stampVal; seed.push(n2); }
      }
    }
    var best = null, bestD = Infinity, ring = -1;
    while (head < queue.length) {
      var q = queue[head], s = src[head]; head++;
      var qx = q % w, qy = (q / w) | 0, sx = s % w, sy = (s / w) | 0;
      var cheb = Math.max(Math.abs(qx - sx), Math.abs(qy - sy));
      /* a Chebyshev ring past the best Euclidean hit cannot do better */
      if (best && cheb > bestD) break;
      if (cheb !== ring) ring = cheb;
      var lq = label[q];
      if (lq >= 0 && lq !== id && !skip[lq]) {
        var d = Math.sqrt((qx - sx) * (qx - sx) + (qy - sy) * (qy - sy));
        if (d < bestD) { bestD = d; best = { island: lq, from: s, to: q, cells: Math.round(d * 100) / 100 }; }
        continue;
      }
      for (var ey = -1; ey <= 1; ey++) for (var ex = -1; ex <= 1; ex++) {
        var mx = qx + ex, my = qy + ey;
        if (mx < 0 || my < 0 || mx >= w || my >= h) continue;
        var m2 = my * w + mx;
        if (stamp[m2] === stampVal) continue;
        stamp[m2] = stampVal;
        queue.push(m2); src.push(s);
      }
    }
    return best;
  }

  /**
   * islandRoute(data, color, from, opts) -> { order:[id], hops:[{ from, to, cells, cm, cut }], cm, cuts }
   * A greedy cross-country route: start at the island nearest `from`, then
   * always the nearest island not yet stitched. `cut` marks a carry longer
   * than opts.carryCm (default 2.5 cm, about an inch): start a new thread.
   * opts.todo (default true) leaves out islands already done; opts.max
   * (default 400) caps the route length (the rest is left to the next call).
   */
  function islandRoute(data, color, from, opts) {
    opts = isObj(opts) ? opts : {};
    var g = gridOf(data), isl = islands(data, color);
    var out = { order: [], hops: [], cm: 0, cuts: 0 };
    if (!g || !isl.count) return out;
    var carry = num(opts.carryCm, 2.5), perCm = cellsPerCm(data);
    var todo = opts.todo !== false, max = clampInt(opts.max, 1, 100000, 400);
    var skip = {}, left = 0, i;
    for (i = 0; i < isl.list.length; i++) {
      if (todo && isl.list[i].done >= isl.list[i].n) skip[i] = 1; else left++;
    }
    if (!left) return out;
    from = isObj(from) ? from : {};
    var fx = clampInt(from.x, 0, g.w - 1, 0), fy = clampInt(from.y, 0, g.h - 1, 0);
    var start = -1, sd = Infinity;
    for (i = 0; i < isl.list.length; i++) {
      if (skip[i]) continue;
      var L = isl.list[i];
      var dx = fx < L.x0 ? L.x0 - fx : (fx > L.x1 ? fx - L.x1 : 0);
      var dy = fy < L.y0 ? L.y0 - fy : (fy > L.y1 ? fy - L.y1 : 0);
      var dd = dx * dx + dy * dy;
      if (dd < sd) { sd = dd; start = i; }
    }
    var stamp = new Int32Array(g.w * g.h), sv = 0, cur = start;
    out.order.push(cur);
    skip[cur] = 1;
    while (out.order.length < Math.min(left, max)) {
      var hop = nearestIsland(isl, g.w, g.h, cur, skip, stamp, ++sv);
      if (!hop) break;
      var cm = Math.round(hop.cells / perCm * 10) / 10;
      var cut = cm > carry;
      out.hops.push({ from: cur, to: hop.island, cells: hop.cells, cm: cm, cut: cut,
        at: { x: hop.to % g.w, y: (hop.to / g.w) | 0 } });
      out.cm = Math.round((out.cm + cm) * 10) / 10;
      if (cut) out.cuts++;
      cur = hop.island;
      skip[cur] = 1;
      out.order.push(cur);
    }
    return out;
  }

  /**
   * islandAt(data, x, y) -> { id, of, n, done, nextCm, nextCells, cut, text } | null
   * The readout: "island 4 of 37 · 12 stitches here · next island 3.1 cm away".
   */
  function islandAt(data, x, y, opts) {
    opts = isObj(opts) ? opts : {};
    var g = gridOf(data);
    if (!g) return null;
    x = clampInt(x, 0, g.w - 1, -1); y = clampInt(y, 0, g.h - 1, -1);
    if (x < 0 || y < 0) return null;
    var color = g.cells[y * g.w + x];
    if (color < 0) return null;
    var isl = islands(data, color), id = isl.label[y * g.w + x];
    if (id < 0) return null;
    var skip = {};
    skip[id] = 1;
    var hop = isl.count > 1 ? nearestIsland(isl, g.w, g.h, id, skip, new Int32Array(g.w * g.h), 1) : null;
    var perCm = cellsPerCm(data), carry = num(opts.carryCm, 2.5);
    var cm = hop ? Math.round(hop.cells / perCm * 10) / 10 : null;
    var L = isl.list[id];
    return {
      id: id, of: isl.count, n: L.n, done: L.done, color: color,
      nextCm: cm, nextCells: hop ? hop.cells : null, cut: cm !== null && cm > carry,
      text: 'island ' + (id + 1) + ' of ' + isl.count + ' · ' + fmtInt(L.n) + ' ' + plural(L.n, 'stitch', 'stitches') + ' here' +
        (hop ? ' · next island ≈ ' + cm + ' cm away' + (cm > carry ? ' (start a new thread rather than carry)' : '') : '')
    };
  }

  /* ---- templates (shell-data §2) --------------------------------------- */

  /** A template from a project: the chart, key and fabric, no progress. */
  function templateFromProject(project) {
    var cd = isObj(project) && isObj(project.craftData) ? project.craftData : null;
    if (!cd) return null;
    var d = normalize(deepCopy(cd), null);
    if (!d) return null;
    d.progress = {};
    d.parking = [];
    d.current = {};
    d.goals = undefined;
    d.sizeWarnedAt = 0;
    var out = normalize(d, null);
    if (dataSize(out) > 250000) { out.chart = null; out = normalize(out, null); }
    return { craftData: out };
  }

  /* ---- #10 backstitch, knots and fractionals from drawn graphics --------- */

  /**
   * ornamentsFromGraphics(g, palette, opts) -> { back, knots, part, unmatched, stats }
   *
   * g = { segments:[{ x1,y1,x2,y2, hex, width }], circles:[{ x, y, r, hex }],
   *       polys:[{ pts:[x,y,...], hex }] }, in chart cells (0,0 = top-left
   * corner of the chart; extractGrid().graphics is exactly this).
   *  - Grid lines are dropped: any width used by axis-aligned lines that run
   *    10+ cells is a grid width, and lines of that width on the lattice go.
   *  - Segments snap to the half-cell lattice (more than 0.15 off: not a
   *    backstitch), are split into unit steps along straight, axis or 45°
   *    runs (the OXS model, one bit of progress per step) and de-duplicated.
   *  - Colour: nearest palette entry of kind 'back' (CIEDE2000 < opts.maxDE,
   *    default 25); with none in range the item is `unmatched`, never guessed.
   *  - Circles on a vertex: r < 0.3 cell a French knot, else a bead (kind
   *    'knot' / 'bead' entries).
   *  - Polys inside one cell: a quarter square is a quarter stitch (d: 1 tl,
   *    2 tr, 3 bl, 4 br — the direction mapping is unverified against a real
   *    generator, as HANDOFF says), a half-cell triangle a half stitch.
   */
  function ornamentsFromGraphics(g, palette, opts) {
    g = isObj(g) ? g : {};
    opts = isObj(opts) ? opts : {};
    palette = Array.isArray(palette) ? palette : [];
    var maxDE = num(opts.maxDE, 25);
    var out = { back: [], knots: [], part: [], unmatched: [], stats: { segments: 0, grid: 0, offLattice: 0, steps: 0 } };
    function nearestOf(kinds, hex) {
      var lab = hexToLab(hex), best = -1, bd = Infinity;
      if (!lab) return -1;
      for (var i = 0; i < palette.length; i++) {
        if (!kinds[palette[i].kind]) continue;
        var l2 = hexToLab(palette[i].hex);
        if (!l2) continue;
        var dd = deltaE2000(lab, l2);
        if (dd < bd) { bd = dd; best = i; }
      }
      return bd <= maxDE ? best : -1;
    }
    var segs = Array.isArray(g.segments) ? g.segments : [], i;
    var gridW = {};
    for (i = 0; i < segs.length; i++) {
      var s = segs[i], len = Math.sqrt((s.x2 - s.x1) * (s.x2 - s.x1) + (s.y2 - s.y1) * (s.y2 - s.y1));
      if ((Math.abs(s.x1 - s.x2) < 1e-3 || Math.abs(s.y1 - s.y2) < 1e-3) && len >= 10) gridW[Math.round(num(s.width, 0) * 1000)] = 1;
    }
    var isGridW = function (w) {
      var k = Math.round(num(w, 0) * 1000);
      for (var gk in gridW) if (gridW.hasOwnProperty(gk) && Math.abs(+gk - k) <= Math.max(1, +gk * 0.05)) return true;
      return false;
    };
    var seen = {};
    var snap = function (v) { return Math.round(v * 2) / 2; };
    for (i = 0; i < segs.length; i++) {
      var sg = segs[i];
      out.stats.segments++;
      var axis = Math.abs(sg.x1 - sg.x2) < 1e-3 || Math.abs(sg.y1 - sg.y2) < 1e-3;
      var onLat = Math.abs(sg.x1 - Math.round(sg.x1)) < 0.02 || Math.abs(sg.y1 - Math.round(sg.y1)) < 0.02;
      if (axis && onLat && isGridW(sg.width)) { out.stats.grid++; continue; }
      var ax = snap(sg.x1), ay = snap(sg.y1), bx = snap(sg.x2), by = snap(sg.y2);
      if (Math.abs(ax - sg.x1) > 0.15 || Math.abs(ay - sg.y1) > 0.15 || Math.abs(bx - sg.x2) > 0.15 || Math.abs(by - sg.y2) > 0.15 ||
          (ax === bx && ay === by)) { out.stats.offLattice++; continue; }
      var pi = nearestOf({ back: 1 }, sg.hex);
      if (pi < 0) { out.unmatched.push({ type: 'back', x1: ax, y1: ay, x2: bx, y2: by, hex: sg.hex }); continue; }
      var dx = bx - ax, dy = by - ay, steps = 1;
      var adx = Math.abs(dx), ady = Math.abs(dy);
      if (!adx || !ady || adx === ady) {
        var unit = (adx % 1 || ady % 1) ? 0.5 : 1;
        steps = Math.max(1, Math.round(Math.max(adx, ady) / unit));
      }
      for (var k = 0; k < steps; k++) {
        var x1 = ax + dx * k / steps, y1 = ay + dy * k / steps, x2 = ax + dx * (k + 1) / steps, y2 = ay + dy * (k + 1) / steps;
        var key = pi + ':' + Math.min(x1, x2) + ',' + (x1 <= x2 ? y1 : y2) + '-' + Math.max(x1, x2) + ',' + (x1 <= x2 ? y2 : y1);
        if (x1 === x2) key = pi + ':' + x1 + ',' + Math.min(y1, y2) + '|' + Math.max(y1, y2);
        if (seen[key]) continue;
        seen[key] = 1;
        out.back.push({ x1: x1, y1: y1, x2: x2, y2: y2, i: pi });
        out.stats.steps++;
      }
    }
    var circ = Array.isArray(g.circles) ? g.circles : [];
    for (i = 0; i < circ.length; i++) {
      var c = circ[i], bead = num(c.r, 0) >= 0.3;
      var ki = nearestOf(bead ? { bead: 1, knot: 1 } : { knot: 1, bead: 1 }, c.hex);
      var cx = snap(num(c.x, 0)), cy = snap(num(c.y, 0));
      if (ki < 0) { out.unmatched.push({ type: bead ? 'bead' : 'knot', x: cx, y: cy, hex: c.hex }); continue; }
      out.knots.push({ x: cx, y: cy, i: ki, t: palette[ki].kind === 'bead' || bead ? 'bead' : 'knot' });
    }
    var polys = Array.isArray(g.polys) ? g.polys : [];
    for (i = 0; i < polys.length; i++) {
      var pts = polys[i].pts || [], x0 = Infinity, y0 = Infinity, x1b = -Infinity, y1b = -Infinity, v;
      for (v = 0; v < pts.length; v += 2) {
        x0 = Math.min(x0, pts[v]); x1b = Math.max(x1b, pts[v]); y0 = Math.min(y0, pts[v + 1]); y1b = Math.max(y1b, pts[v + 1]);
      }
      var cellX = Math.floor((x0 + x1b) / 2), cellY = Math.floor((y0 + y1b) / 2);
      var pw = x1b - x0, ph = y1b - y0, pa = nearestOf({ cross: 1, half: 1, blend: 1 }, polys[i].hex);
      if (pa < 0 || !(pw > 0.2) || x1b - cellX > 1.05 || y1b - cellY > 1.05) { out.unmatched.push({ type: 'part', x: cellX, y: cellY, hex: polys[i].hex }); continue; }
      var d;
      if (pw < 0.6 && ph < 0.6) {
        var qx = (x0 + x1b) / 2 - cellX < 0.5 ? 0 : 1, qy = (y0 + y1b) / 2 - cellY < 0.5 ? 0 : 1;
        d = 1 + qx + qy * 2;
      } else if (pts.length === 6) {
        /* which corner the right angle sits in tells / from \ */
        var area = Math.abs((pts[2] - pts[0]) * (pts[5] - pts[1]) - (pts[4] - pts[0]) * (pts[3] - pts[1])) / 2;
        if (area < 0.35 || area > 0.65) { out.unmatched.push({ type: 'part', x: cellX, y: cellY, hex: polys[i].hex }); continue; }
        var sx = 0, sy = 0;
        for (v = 0; v < 6; v += 2) { sx += pts[v] - cellX; sy += pts[v + 1] - cellY; }
        sx /= 3; sy /= 3;
        d = (sx < 0.5) === (sy < 0.5) ? 2 : 1;      // centroid tl/br: "\" half (2); tr/bl: "/" half (1)
      } else { out.unmatched.push({ type: 'part', x: cellX, y: cellY, hex: polys[i].hex }); continue; }
      out.part.push({ x: cellX, y: cellY, a: pa, b: -1, d: d });
    }
    return out;
  }

  /* ---- #5 sessions, shown per stitch (shell-data owns the log) ----------- */

  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dayLabel(ms) {
    var dt = new Date(ms);
    return DAY_NAMES[dt.getDay()] + ' ' + dt.getDate() + ' ' + MONTH_NAMES[dt.getMonth()];
  }
  function dayKey(ms) {
    var dt = new Date(ms), m = dt.getMonth() + 1, dd = dt.getDate();
    return dt.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd;
  }

  /**
   * sessionLines(activity, opts) -> [{ s, e, ms, n, colours, text }] newest first
   * activity = Store.activity(id) ({ sessions:[{ s, e, c:{stitch}, by:{ 'DMC 310':{stitch} } }] }).
   * "Tue 11 Nov · 52 min · 318 stitches · DMC 310, 3843".
   */
  function sessionLines(activity, opts) {
    opts = isObj(opts) ? opts : {};
    var unit = str(opts.unit, 'stitch'), list = isObj(activity) && Array.isArray(activity.sessions) ? activity.sessions : [];
    var out = [];
    for (var i = list.length - 1; i >= 0; i--) {
      var s = list[i];
      if (!isObj(s)) continue;
      var n = isObj(s.c) ? clampInt(s.c[unit], -1e9, 1e9, 0) : 0;
      if (n <= 0 && !opts.all) continue;
      var ms = Math.max(0, num(s.e, 0) - num(s.s, 0)), mins = Math.max(1, Math.round(ms / 60000));
      var by = isObj(s.by) ? s.by : {}, cols = Object.keys(by).filter(function (k) { return isObj(by[k]) && by[k][unit] > 0; })
        .sort(function (a, b) { return by[b][unit] - by[a][unit]; });
      var shown = cols.slice(0, 3).map(function (k, j) { return j ? k.replace(/^DMC\s+/, '') : k; });
      out.push({ s: s.s, e: s.e, ms: ms, n: n, colours: cols,
        text: dayLabel(s.s) + ' · ' + (mins >= 60 ? Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min' : mins + ' min') + ' · ' +
          fmtInt(n) + ' ' + plural(n, 'stitch', 'stitches') + (shown.length ? ' · ' + shown.join(', ') + (cols.length > 3 ? ' +' + (cols.length - 3) : '') : '') });
    }
    return out;
  }

  /** dayStrip(activity, days, now) -> [{ day:'YYYY-MM-DD', label, n }] oldest first. */
  function dayStrip(activity, days, now, opts) {
    opts = isObj(opts) ? opts : {};
    var unit = str(opts.unit, 'stitch'), map = isObj(activity) && isObj(activity.days) ? activity.days : {};
    days = clampInt(days, 1, 366, 7);
    var t = nowMs(now), out = [];
    for (var i = days - 1; i >= 0; i--) {
      var ms = t - i * 86400000, k = dayKey(ms), rec = map[k];
      out.push({ day: k, label: DAY_NAMES[new Date(ms).getDay()], n: isObj(rec) ? clampInt(rec[unit], 0, 1e9, 0) : 0 });
    }
    return out;
  }

  /* ---- #21 find my place, and goals ------------------------------------ */

  /**
   * findPlace(data, text) -> { x, y, page?, block?, text } | { error }
   * "col 134 row 57", "row 57 col 134", "134, 57", "134 x 57", "page 9",
   * "p9", "block 13,6". Rows and columns are counted from 1, as printed.
   */
  function findPlace(data, text) {
    var g = isObj(data) && isObj(data.chart) ? data.chart : null;
    if (!g) return { error: 'There is no chart to move around.' };
    var w = g.w, h = g.h, s = String(text == null ? '' : text).toLowerCase().trim(), m;
    var off = function () { return { error: 'That is off the chart (' + w + ' × ' + h + ' stitches).' }; };
    if ((m = /^(?:page|p)\s*(\d{1,4})$/.exec(s))) {
      var want = +m[1], pages = Array.isArray(data.pages) ? data.pages : [];
      for (var i = 0; i < pages.length; i++) {
        var lab = /(\d+)\s*$/.exec(str(pages[i].label, ''));
        if (pages[i].region && ((lab && +lab[1] === want) || (!lab && pages[i].n + 1 === want))) {
          var r = pages[i].region;
          return { x: r.x + (r.w >> 1), y: r.y + (r.h >> 1), page: i, text: str(pages[i].label, 'Page ' + want) };
        }
      }
      return { error: 'Page ' + want + ' does not print part of this chart.' };
    }
    if ((m = /^block\s*(\d{1,4})\s*[,;\s]\s*(\d{1,4})$/.exec(s))) {
      var bx = +m[1] - 1, by = +m[2] - 1;
      if (bx < 0 || by < 0 || bx * 10 >= w || by * 10 >= h) return off();
      var x = Math.min(w - 1, bx * 10 + 4), y = Math.min(h - 1, by * 10 + 4);
      return { x: x, y: y, block: { bx: bx, by: by }, text: 'block ' + m[1] + ',' + m[2] };
    }
    var col = null, row = null;
    if ((m = /col(?:umn)?\s*(\d{1,5})/.exec(s))) col = +m[1];
    if ((m = /row\s*(\d{1,5})/.exec(s))) row = +m[1];
    if (col === null && row === null && (m = /^(\d{1,5})\s*(?:[,;x×*]|\s)\s*(\d{1,5})$/.exec(s))) { col = +m[1]; row = +m[2]; }
    if (col === null && row === null) return { error: 'Type a column and row ("col 134 row 57"), a page ("page 9") or a block ("block 13,6").' };
    if (col === null) col = 1;
    if (row === null) row = 1;
    if (col < 1 || row < 1 || col > w || row > h) return off();
    return { x: col - 1, y: row - 1, text: positionLabel(col - 1, row - 1, w, h).grid };
  }

  /**
   * goalProgress(goal, data, activity, now) -> { done, target, left, pct, met, perDayNeeded, text, approx }
   * goal = { kind: 'perDay', n } | { kind: 'page', page, by } | { kind: 'colour', color, by } |
   *        { kind: 'total', by }. perDayNeeded is ≈ (marked approx) and only with a `by` date.
   */
  function goalProgress(goal, data, activity, now) {
    goal = isObj(goal) ? goal : {};
    var t = nowMs(now), done = 0, target = 0, what = '';
    if (goal.kind === 'perDay') {
      var days = isObj(activity) && isObj(activity.days) ? activity.days : {};
      var rec = days[dayKey(t)];
      done = isObj(rec) ? clampInt(rec.stitch, 0, 1e9, 0) : 0;
      target = clampInt(goal.n, 1, 1e7, 100);
      return { done: done, target: target, left: Math.max(0, target - done), pct: Math.min(100, Math.floor(done / target * 100)),
        met: done >= target, perDayNeeded: null, approx: false,
        text: fmtInt(done) + ' of ' + fmtInt(target) + ' today' + (done >= target ? ' ✓' : '') };
    }
    if (goal.kind === 'page') {
      var pp = pageProgress(data), row = null;
      for (var i = 0; i < pp.length; i++) if (pp[i].page === clampInt(goal.page, 0, 9999, -1)) row = pp[i];
      if (!row) return { done: 0, target: 0, left: 0, pct: 0, met: false, perDayNeeded: null, approx: false, text: 'That page has no part of the chart.' };
      done = row.done; target = row.total; what = str(row.label, 'Page');
    } else if (goal.kind === 'colour') {
      var st = progressStats(data), c = st.byColor[clampInt(goal.color, 0, 9999, -1)];
      if (!c) return { done: 0, target: 0, left: 0, pct: 0, met: false, perDayNeeded: null, approx: false, text: 'No such colour.' };
      done = c.done; target = c.total; what = flossLabel(data.palette[goal.color]);
    } else {
      var tt = totals(data);
      done = tt.done; target = tt.total; what = 'the piece';
    }
    var left = Math.max(0, target - done), need = null;
    if (goal.by && left > 0) {
      var daysLeft = Math.max(1, Math.ceil((num(goal.by, t) - t) / 86400000));
      need = Math.ceil(left / daysLeft);
    }
    return { done: done, target: target, left: left, pct: target ? Math.floor(done / target * 100) : 0, met: target > 0 && !left,
      perDayNeeded: need, approx: need !== null,
      text: (target && !left ? what + ' done ✓' : fmtInt(left) + ' left on ' + what) +
        (need !== null ? ' · ≈ ' + fmtInt(need) + ' a day to finish by ' + dayLabel(num(goal.by, t)) : '') };
  }

  /* ---- X3 the mark log (shell-data stores it; this replays it) ----------- */

  /**
   * markDiff(prevB64, nextB64, n) -> [[cellIndex, 1|0]] — what changed between
   * two progress bitmaps, for Store.logMarks after a bulk mark or an undo.
   */
  function markDiff(prev, next, n) {
    var a = b64ToBytes(str(prev, '')), b = b64ToBytes(str(next, ''));
    n = clampInt(n, 0, 1e9, Math.max(a.length, b.length) * 8);
    var out = [], bytes = Math.ceil(n / 8);
    for (var k = 0; k < bytes; k++) {
      var x = (a[k] || 0) ^ (b[k] || 0);
      if (!x) continue;
      for (var bit = 0; bit < 8; bit++) {
        if (!((x >> bit) & 1)) continue;
        var i = k * 8 + bit;
        if (i < n) out.push([i, ((b[k] || 0) >> bit) & 1]);
      }
    }
    return out;
  }

  /**
   * replayMarks(chunks, n, opts) -> { frames, next() -> { at, bits, changed } | null, reset() }
   * chunks = Store.readMarks(id) ([{ at, marks:[[i, 1|0]] }], in order). Each
   * frame applies one chunk (or opts.perFrame marks at most) to ONE bitmap
   * (Uint8Array, one byte per cell, shared between frames: copy it to keep
   * it) and lists the changed cells, so a renderer can redraw only those.
   * Replaying all of it reproduces the progress bitmap bit for bit.
   */
  function replayMarks(chunks, n, opts) {
    opts = isObj(opts) ? opts : {};
    chunks = Array.isArray(chunks) ? chunks : [];
    n = clampInt(n, 0, 1e8, 0);
    var per = clampInt(opts.perFrame, 0, 1e7, 0);
    var bits = new Uint8Array(n), ci = 0, mi = 0;
    var frames = 0;
    for (var k = 0; k < chunks.length; k++) {
      var len = isObj(chunks[k]) && Array.isArray(chunks[k].marks) ? chunks[k].marks.length : 0;
      frames += per ? Math.max(1, Math.ceil(len / per)) : 1;
    }
    return {
      frames: frames,
      bits: bits,
      next: function () {
        if (ci >= chunks.length) return null;
        var ch = isObj(chunks[ci]) ? chunks[ci] : {}, marks = Array.isArray(ch.marks) ? ch.marks : [];
        var end = per ? Math.min(marks.length, mi + per) : marks.length, changed = [];
        for (var q = mi; q < end; q++) {
          var m = marks[q], i = clampInt(m && m[0], -1, n - 1, -1);
          if (i < 0) continue;
          var v = m[1] ? 1 : 0;
          if (bits[i] !== v) { bits[i] = v; changed.push(i); }
        }
        var at = num(ch.at, 0);
        if (end >= marks.length) { ci++; mi = 0; } else mi = end;
        return { at: at, bits: bits, changed: changed };
      },
      reset: function () { for (var z = 0; z < n; z++) bits[z] = 0; ci = 0; mi = 0; }
    };
  }

  /* ---- #15 floss identity, needs and a kitting list ---------------------- */

  /** flossId('DMC', '04') -> 'dmc:4' (the profile's floss rows are keyed brand -> code). */
  function flossId(brand, code) {
    var k = codeKey(brand, code);
    return k ? k.replace('|', ':') : '';
  }

  /**
   * flossNeeds(data, opts) -> { [brand]: { [code]: { skeins, stitches, name } } }
   * Skeins each colour of a project needs (skeinPlan's "buy" with no stash);
   * the stitches come from the chart, else the key's printed count.
   * Backstitch / knot rows count one skein unless the key printed skeins.
   */
  function flossNeeds(data, opts) {
    opts = isObj(opts) ? opts : {};
    var d = isObj(data) ? data : {}, out = {}, st = progressStats(d);
    var f = isObj(d.fabric) ? d.fabric : {};
    var pal = Array.isArray(d.palette) ? d.palette : [];
    for (var i = 0; i < pal.length; i++) {
      var e = pal[i], k = codeKey(e.brand || 'DMC', e.code);
      if (!k || e.unresolved) continue;
      var parts = k.split('|'), brand = parts[0], code = parts[1];
      var cell = CHECK_KINDS[e.kind || 'cross'];
      var stitches = cell ? ((st.byColor[i] && st.byColor[i].total) || e.keyCount || e.stitchCount || 0) : 0;
      if (opts.remaining && cell && st.byColor[i]) stitches = Math.max(0, stitches - st.byColor[i].done);
      var sk = cell ? skeinRange({ stitchCount: stitches, count: f.count, over: f.over, strands: e.strands }).mid
        : Math.max(1, clampInt(e.skeins, 0, 999, 0));
      if (e.skeins > sk) sk = e.skeins;
      if (!sk) continue;
      var b = out[brand] = out[brand] || {};
      var cur = b[code] || { skeins: 0, stitches: 0, name: e.name || '', printed: str(e.code, '') };
      cur.skeins += sk; cur.stitches += stitches;
      b[code] = cur;
    }
    return out;
  }

  /** The profile's floss shape, or Store.flossStash()'s array, as { brand: { code: owned } }. */
  function stashMap(stash) {
    var m = {}, i;
    if (Array.isArray(stash)) {
      for (i = 0; i < stash.length; i++) {
        var r = stash[i];
        if (!isObj(r)) continue;
        var id = flossId(r.brand, r.code);
        if (id) m[id] = (m[id] || 0) + clampInt(r.owned, 0, 1e6, 0);
      }
    } else if (isObj(stash)) {
      var bs = Object.keys(stash);
      for (i = 0; i < bs.length; i++) {
        var codes = isObj(stash[bs[i]]) ? stash[bs[i]] : {}, cs = Object.keys(codes);
        for (var j = 0; j < cs.length; j++) {
          var v = codes[cs[j]], owned = isObj(v) ? v.owned : v;
          var id2 = flossId(bs[i], cs[j]);
          if (id2) m[id2] = (m[id2] || 0) + clampInt(owned, 0, 1e6, 0);
        }
      }
    }
    return m;
  }

  /**
   * kitList(projects, stash, opts) -> { projects:[{ id, title, rows:[{ id, brand, code, name, need,
   *   allocated, buy, setAside:[{ id, n }] }], buy }], buyTotal }
   * projects = [{ id, title, data }] in priority order (active WIPs first);
   * each takes what it needs from the stash before the next one does.
   * Computed, never stored (the same rule as Store.flossAllocation).
   */
  function kitList(projects, stash, opts) {
    opts = isObj(opts) ? opts : {};
    var left = stashMap(stash), out = { projects: [], buyTotal: 0 }, given = {};
    projects = Array.isArray(projects) ? projects : [];
    for (var p = 0; p < projects.length; p++) {
      var pr = projects[p] || {}, needs = flossNeeds(pr.data, { remaining: opts.remaining !== false });
      var rows = [], buy = 0;
      Object.keys(needs).sort().forEach(function (brand) {
        Object.keys(needs[brand]).sort(function (a, b) { return (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0) || (a < b ? -1 : 1); })
          .forEach(function (code) {
            var id = brand + ':' + code, need = needs[brand][code].skeins, have = left[id] || 0;
            var alloc = Math.min(need, have);
            left[id] = have - alloc;
            var row = { id: id, brand: brand === 'dmc' ? 'DMC' : brand.charAt(0).toUpperCase() + brand.slice(1), code: code,
              printed: needs[brand][code].printed || code,
              name: needs[brand][code].name, need: need, allocated: alloc, buy: need - alloc,
              setAside: (given[id] || []).slice() };
            (given[id] = given[id] || []).push({ id: pr.id, n: alloc });
            buy += row.buy;
            rows.push(row);
          });
      });
      out.projects.push({ id: pr.id, title: str(pr.title, ''), rows: rows, buy: buy });
      out.buyTotal += buy;
    }
    return out;
  }

  /* ---- #16 brand tables, pluggable, with provenance ----------------------- */

  var BRAND_TABLES = {};

  /**
   * registerBrandTable({ brand, rows:['code|name|hex'], provenance:{ source, licence, url, approx } })
   * -> { ok, brand, n } | { ok:false, reason }. No table is shipped for any
   * brand but DMC until a licensed source is approved (BUILD decision).
   */
  function registerBrandTable(t) {
    t = isObj(t) ? t : {};
    var brand = canonBrand(t.brand) || str(t.brand, '').trim();
    if (!brand || brand === 'DMC') return { ok: false, reason: 'DMC is built in; give another brand.' };
    var pv = isObj(t.provenance) ? t.provenance : {};
    if (!str(pv.source, '') || !str(pv.licence, '')) return { ok: false, reason: 'A colour table needs its source and licence.' };
    var rows = [], raw = Array.isArray(t.rows) ? t.rows : [];
    for (var i = 0; i < raw.length; i++) {
      var p = String(raw[i]).split('|'), hex = normHex(p[2], null), code = str(p[0], '').trim();
      if (!code || !hex) continue;
      var rgb = hexToRgb(hex);
      rows.push({ code: code, name: str(p[1], '').trim(), hex: hex, lab: rgbToLab(rgb[0], rgb[1], rgb[2]) });
    }
    if (!rows.length) return { ok: false, reason: 'No usable rows (code|name|hex).' };
    BRAND_TABLES[brand.toLowerCase()] = { brand: brand, rows: rows,
      provenance: { source: str(pv.source, ''), licence: str(pv.licence, ''), url: str(pv.url, ''), approx: pv.approx !== false } };
    return { ok: true, brand: brand, n: rows.length };
  }

  function tableFor(brand) {
    var b = String(brand == null ? '' : brand).trim().toLowerCase() || 'dmc';
    if (b === 'dmc') {
      return { brand: 'DMC', rows: FLOSS.dmc, provenance: { source: 'sharlagelfand/dmc (floss_adrianj.csv)', licence: 'MIT', url: 'https://github.com/sharlagelfand/dmc', approx: true } };
    }
    return BRAND_TABLES[b] || null;
  }

  /** brandTables() -> [{ brand, n, provenance }] (DMC always first). */
  function brandTables() {
    var out = [{ brand: 'DMC', n: FLOSS.dmc.length, provenance: tableFor('DMC').provenance }];
    Object.keys(BRAND_TABLES).sort().forEach(function (k) {
      out.push({ brand: BRAND_TABLES[k].brand, n: BRAND_TABLES[k].rows.length, provenance: BRAND_TABLES[k].provenance });
    });
    return out;
  }

  function matchWord(de) { return de < 2 ? 'very close' : de < 5 ? 'close' : de < 10 ? 'noticeable' : 'different'; }

  function rowFor(table, code) {
    if (!table) return null;
    var want = codeKey(table.brand, code);
    for (var i = 0; i < table.rows.length; i++) if (codeKey(table.brand, table.rows[i].code) === want) return table.rows[i];
    return null;
  }

  function labOfRow(r) {
    if (r.lab) return r.lab;
    var rgb = hexToRgb(r.hex);
    return rgb ? rgbToLab(rgb[0], rgb[1], rgb[2]) : null;
  }

  /**
   * convert(brand, code, toBrand) -> { brand, code, name, hex, deltaE, word, provenance } | { none:true, reason }
   * Matching is by colour difference against each brand's own RGB list,
   * never a typed lookup table. With no table for a brand it says so.
   */
  function convert(brand, code, toBrand) {
    var from = tableFor(brand), to = tableFor(toBrand);
    if (!from) return { none: true, reason: 'There is no ' + str(brand, 'colour') + ' colour table on this device, so its colours cannot be matched.' };
    if (!to) return { none: true, reason: 'There is no ' + str(toBrand, 'colour') + ' colour table on this device, so there is no honest match.' };
    var src = rowFor(from, code);
    if (!src) return { none: true, reason: str(brand, '') + ' ' + str(code, '') + ' is not in the ' + from.brand + ' table.' };
    var lab = labOfRow(src), best = null, bd = Infinity;
    for (var i = 0; i < to.rows.length; i++) {
      var l2 = labOfRow(to.rows[i]);
      if (!l2) continue;
      var dd = deltaE2000(lab, l2);
      if (dd < bd) { bd = dd; best = to.rows[i]; }
    }
    if (!best) return { none: true, reason: 'No colour to match.' };
    return { brand: to.brand, code: best.code, name: best.name, hex: best.hex, deltaE: round1(bd), word: matchWord(bd),
      provenance: to.provenance };
  }

  /**
   * substitutes(brand, code, stash, n) -> [{ brand, code, name, hex, deltaE, word, have }]
   * "I'm out of 3846": the n nearest colours in the stash (any brand with a
   * table), nearest first.
   */
  function substitutes(brand, code, stash, n) {
    var src = rowFor(tableFor(brand), code);
    if (!src) return [];
    var lab = labOfRow(src), m = stashMap(stash), out = [], self = flossId(brand, code);
    Object.keys(m).forEach(function (id) {
      if (id === self || !(m[id] > 0)) return;
      var bc = id.split(':'), t = tableFor(bc[0]), r = rowFor(t, bc[1]);
      if (!r) return;
      var dd = deltaE2000(lab, labOfRow(r));
      out.push({ brand: t.brand, code: r.code, name: r.name, hex: r.hex, deltaE: round1(dd), word: matchWord(dd), have: m[id] });
    });
    out.sort(function (a, b) { return a.deltaE - b.deltaE || (a.code < b.code ? -1 : 1); });
    return out.slice(0, clampInt(n, 1, 50, 3));
  }

  /* ---- #17 fabric, hoop and frame ------------------------------------------ */

  var HOOPS_IN = [4, 5, 6, 7, 8, 9, 10, 12, 14];
  var QSNAPS_IN = [[6, 6], [8, 8], [11, 11], [8, 11], [11, 14], [14, 14], [11, 17], [17, 17]];
  var FRAMES_IN = [[5, 7], [8, 10], [11, 14], [12, 16], [16, 20], [18, 24], [24, 36]];
  var CUTS_IN = [{ name: 'fat eighth', w: 11, h: 18 }, { name: 'fat quarter', w: 18, h: 22 }, { name: 'half yard', w: 18, h: 36 }];

  function fitsIn(w, h, W, H) {
    var a = Math.min(W - w, H - h), b = Math.min(W - h, H - w);
    return Math.max(a, b);
  }

  /**
   * fabricPlan({ w, h, count, over, margin }) -> { design, margin, cut, cuts, hoop, qsnap, frame, text }
   * margin: 'frame' (3 in a side, the default), 'hoop' (2 in) or inches.
   * All sizes in inches and cm; `cuts` says which standard piece the cut fits
   * and how much is spare. The hoop is the smallest one whose inside clears
   * the design's diagonal; frames leave a 2 in mat round a 1/4 in opening.
   */
  function fabricPlan(o) {
    o = isObj(o) ? o : {};
    var m = o.margin === 'hoop' ? 2 : (typeof o.margin === 'number' && o.margin >= 0 ? o.margin : 3);
    var s = finishedSize({ w: o.w, h: o.h, count: o.count, over: o.over });
    var cw = round2(s.wIn + 2 * m), ch = round2(s.hIn + 2 * m);
    var cuts = CUTS_IN.map(function (c) {
      var spare = fitsIn(cw, ch, c.w, c.h);
      return { name: c.name, w: c.w, h: c.h, fits: spare >= 0, spareIn: round1(spare) };
    });
    var diag = Math.sqrt(s.wIn * s.wIn + s.hIn * s.hIn) + 1, hoop = null;
    for (var i = 0; i < HOOPS_IN.length; i++) if (HOOPS_IN[i] >= diag) { hoop = HOOPS_IN[i]; break; }
    var qs = null;
    for (i = 0; i < QSNAPS_IN.length; i++) {
      if (fitsIn(s.wIn + 1, s.hIn + 1, QSNAPS_IN[i][0], QSNAPS_IN[i][1]) >= 0) { qs = QSNAPS_IN[i]; break; }
    }
    var open = { w: round2(s.wIn + 0.5), h: round2(s.hIn + 0.5) }, frame = null;
    for (i = 0; i < FRAMES_IN.length; i++) {
      if (fitsIn(open.w + 4, open.h + 4, FRAMES_IN[i][0], FRAMES_IN[i][1]) >= 0) { frame = FRAMES_IN[i]; break; }
    }
    var fq = cuts[1];
    return {
      design: { wIn: s.wIn, hIn: s.hIn, wCm: s.wCm, hCm: s.hCm },
      margin: { in: m, cm: round1(m * CM_PER_IN) },
      cut: { wIn: cw, hIn: ch, wCm: round1(cw * CM_PER_IN), hCm: round1(ch * CM_PER_IN) },
      cuts: cuts,
      hoop: hoop ? { in: hoop, cm: round1(hoop * CM_PER_IN) } : null,
      qsnap: qs ? { wIn: qs[0], hIn: qs[1] } : null,
      frame: frame ? { wIn: frame[0], hIn: frame[1], opening: open } : null,
      text: 'cut ' + cw + ' × ' + ch + ' in · fits a fat quarter (18 × 22 in)? ' +
        (fq.fits ? 'yes, ' + fq.spareIn + ' in spare' : 'no') +
        (hoop ? ' · ' + hoop + ' in hoop' : ' · bigger than a 14 in hoop: use a frame')
    };
  }

  /**
   * frameFit({ w, h, over }, { wIn, hIn }, counts) -> [{ count, wIn, hIn, fits, spareIn }]
   * The reverse question: "8 × 10 frame: on 16 ct it fits / needs 18 ct".
   */
  function frameFit(design, frame, counts) {
    design = isObj(design) ? design : {};
    frame = isObj(frame) ? frame : {};
    if (!Array.isArray(counts) || !counts.length) counts = [11, 14, 16, 18, 20, 22, 25, 28, 32];
    var out = [];
    for (var i = 0; i < counts.length; i++) {
      var s = finishedSize({ w: design.w, h: design.h, count: counts[i], over: design.over });
      var spare = fitsIn(s.wIn, s.hIn, num(frame.wIn, 0), num(frame.hIn, 0));
      out.push({ count: counts[i], wIn: s.wIn, hIn: s.hIn, fits: spare >= 0, spareIn: round1(spare) });
    }
    return out;
  }

  /* ---- #20 adjacent grid crafts: a kind, not a new craft -------------------- */

  var KINDS = {
    cross: { label: 'Cross-stitch', unit: 'stitch', units: 'stitches', material: 'floss', fabric: true, strands: true, pageWord: 'page' },
    diamond: { label: 'Diamond painting', unit: 'drill', units: 'drills', material: 'drills', fabric: false, strands: false, pageWord: 'section', pack: 200 },
    needlepoint: { label: 'Needlepoint', unit: 'stitch', units: 'stitches', material: 'yarn', fabric: true, strands: false, pageWord: 'page', meshWord: 'mesh' },
    filet: { label: 'Filet crochet', unit: 'mesh', units: 'meshes', material: 'thread', fabric: false, strands: false, pageWord: 'page' },
    fusebead: { label: 'Fuse beads', unit: 'bead', units: 'beads', material: 'beads', fabric: false, strands: false, pageWord: 'pegboard', pack: 1000 }
  };

  /** kindOf(data) -> 'cross' | 'diamond' | 'needlepoint' | 'filet' | 'fusebead'. */
  function kindOf(data) { return isObj(data) && KINDS[data.kind] ? data.kind : 'cross'; }

  /**
   * materials(data, i) -> { amount, unit, packs?, text, approx }
   * What one colour takes, in the kind's own terms: skeins of floss, drills
   * in packs of 200 (10% spare), wool for tent stitch (≈, by mesh count),
   * filet thread per mesh (≈), fuse beads.
   */
  function materials(data, i) {
    var d = isObj(data) ? data : {}, k = kindOf(d), K = KINDS[k];
    var e = Array.isArray(d.palette) ? d.palette[i] : null;
    if (!e) return { amount: 0, unit: K.units, text: '', approx: false };
    var st = progressStats(d), n = (st.byColor[i] && st.byColor[i].total) || e.keyCount || e.stitchCount || 0;
    var f = isObj(d.fabric) ? d.fabric : {};
    if (k === 'diamond' || k === 'fusebead') {
      var want = Math.ceil(n * (k === 'diamond' ? 1.1 : 1.05)), packs = Math.ceil(want / K.pack);
      return { amount: want, unit: K.units, packs: packs, approx: true,
        text: fmtInt(n) + ' ' + plural(n, K.unit, K.units) + ' · ' + packs + ' ' + plural(packs, 'pack') + ' of ' + K.pack };
    }
    if (k === 'needlepoint') {
      var mesh = effectiveCount(f.count, 1), m = Math.ceil(n * (CM_PER_IN / mesh) * 3.2 / 100 * 10) / 10;
      return { amount: m, unit: 'm', approx: true, text: '≈ ' + m + ' m of wool (tent stitch on ' + mesh + ' mesh)' };
    }
    if (k === 'filet') {
      var mm = Math.ceil(n * 0.06 * 10) / 10;
      return { amount: mm, unit: 'm', approx: true, text: fmtInt(n) + ' filled ' + plural(n, 'mesh', 'meshes') + ' · ≈ ' + mm + ' m of thread' };
    }
    var sp = skeinPlan({ stitchCount: n, count: f.count, over: f.over, strands: e.strands, have: e.have ? 1 : 0 });
    return { amount: sp.mid, unit: 'skeins', approx: true, text: sp.text };
  }

  /**
   * filetRowText(row, data) -> 'Row 5 (left to right): 3 open, 7 filled, 2 open'
   * A filet chart is two-state: any stitched square is a filled mesh, an
   * empty one is open. `row` is one of writtenRows().rows.
   */
  function filetRowText(row, data) {
    row = isObj(row) ? row : {};
    var runs = Array.isArray(row.runs) ? row.runs : [], parts = [], merged = [];
    for (var i = 0; i < runs.length; i++) {
      var filled = runs[i].p >= 0;
      if (merged.length && merged[merged.length - 1].f === filled) merged[merged.length - 1].n += runs[i].n;
      else merged.push({ f: filled, n: runs[i].n });
    }
    for (i = 0; i < merged.length; i++) parts.push(merged[i].n + ' ' + (merged[i].f ? 'filled' : 'open'));
    return 'Row ' + (row.n === undefined ? num(row.y, 0) + 1 : row.n) + ' (' + (row.rtl ? 'right to left' : 'left to right') + '): ' +
      (parts.length ? parts.join(', ') : 'nothing');
  }

  /* ---- #18 joining quadrant files ---------------------------------------- */

  /**
   * quadrantLayout(datas, names) -> [{ x, y }]
   * Where each part goes: names saying tl / tr / bl / br (or "top left" …)
   * are placed as quadrants by the parts' own sizes; otherwise row by row,
   * two to a row.
   */
  function quadrantLayout(datas, names) {
    datas = Array.isArray(datas) ? datas : [];
    names = Array.isArray(names) ? names : [];
    var tag = names.map(function (n) {
      var s = String(n || '').toLowerCase().replace(/[^a-z]+/g, ' ');
      if (/\btl\b|top left|upper left/.test(s)) return 'tl';
      if (/\btr\b|top right|upper right/.test(s)) return 'tr';
      if (/\bbl\b|bottom left|lower left/.test(s)) return 'bl';
      if (/\bbr\b|bottom right|lower right/.test(s)) return 'br';
      return null;
    });
    var size = function (d) { return isObj(d) && isObj(d.chart) ? { w: d.chart.w, h: d.chart.h } : { w: 0, h: 0 }; };
    var idx = {};
    tag.forEach(function (t, i) { if (t && idx[t] === undefined) idx[t] = i; });
    var out = [];
    if (Object.keys(idx).length === datas.length && datas.length) {
      var wtl = idx.tl !== undefined ? size(datas[idx.tl]).w : (idx.bl !== undefined ? size(datas[idx.bl]).w : 0);
      var htl = idx.tl !== undefined ? size(datas[idx.tl]).h : (idx.tr !== undefined ? size(datas[idx.tr]).h : 0);
      for (var i = 0; i < datas.length; i++) {
        var t = tag[i];
        out.push({ x: t === 'tr' || t === 'br' ? wtl : 0, y: t === 'bl' || t === 'br' ? htl : 0 });
      }
      return out;
    }
    var x = 0, y = 0, rowH = 0;
    for (var j = 0; j < datas.length; j++) {
      if (j && j % 2 === 0) { x = 0; y += rowH; rowH = 0; }
      out.push({ x: x, y: y });
      x += size(datas[j]).w;
      rowH = Math.max(rowH, size(datas[j]).h);
    }
    return out;
  }

  /**
   * joinCharts(parts:[{ data, x, y }], opts) -> { data, w, h, maps:[[old -> new]], conflicts }
   * One chart from several files (the four Pokémon quadrants). Colours are
   * merged by brand + code (else hex + name), squares, backstitch, knots,
   * fractionals, done bits and page regions are moved by each part's offset.
   * `conflicts` counts squares two parts give different colours (the later
   * part wins).
   */
  function joinCharts(parts, opts) {
    opts = isObj(opts) ? opts : {};
    parts = Array.isArray(parts) ? parts.filter(function (p) { return isObj(p) && isObj(p.data); }) : [];
    var W = 0, H = 0, i, k;
    var norm = parts.map(function (p) { return { d: normalize(p.data, null), x: clampInt(p.x, 0, 20000, 0), y: clampInt(p.y, 0, 20000, 0) }; });
    for (i = 0; i < norm.length; i++) {
      if (!norm[i].d.chart) continue;
      W = Math.max(W, norm[i].x + norm[i].d.chart.w);
      H = Math.max(H, norm[i].y + norm[i].d.chart.h);
    }
    if (!W || !H || W * H > 4000000) return { data: null, w: W, h: H, maps: [], conflicts: 0, error: W * H > 4000000 ? 'too big' : 'no charts' };
    var palette = [], byKey = {}, maps = [];
    var first = norm[0].d;
    for (i = 0; i < norm.length; i++) {
      var map = [];
      norm[i].d.palette.forEach(function (e) {
        var key = codeKey(e.brand || 'DMC', e.code) || ('hex|' + e.hex + '|' + e.name + '|' + e.kind);
        key += '|' + e.kind;
        if (!byKey.hasOwnProperty(key)) {
          byKey[key] = palette.length;
          var c = deepCopy(e);
          c.i = palette.length;
          c.stitchCount = 0;
          if (c.keyCount) c.keyCount = 0;
          palette.push(c);
        }
        var ni = byKey[key];
        if (e.keyCount) palette[ni].keyCount = (palette[ni].keyCount || 0) + e.keyCount;
        map.push(ni);
      });
      maps.push(map);
    }
    var cells = new Int16Array(W * H), done = new Uint8Array(Math.ceil(W * H / 8)), conflicts = 0;
    for (i = 0; i < cells.length; i++) cells[i] = -1;
    var back = [], knots = [], part = [], pages = [];
    for (i = 0; i < norm.length; i++) {
      var n = norm[i], d = n.d;
      if (!d.chart) continue;
      var g = chartCells(d.chart), bytes = doneOf(d, g.w * g.h), mp = maps[i];
      for (var y = 0; y < g.h; y++) {
        for (var x = 0; x < g.w; x++) {
          var v = g.cells[y * g.w + x];
          if (v < 0) continue;
          var j = (y + n.y) * W + (x + n.x), nv = mp[v] === undefined ? -1 : mp[v];
          if (cells[j] >= 0 && cells[j] !== nv) conflicts++;
          cells[j] = nv;
          if (bitOn(bytes, y * g.w + x)) done[j >> 3] |= 1 << (j & 7);
          else done[j >> 3] &= ~(1 << (j & 7));
        }
      }
      d.chart.back.forEach(function (b) { back.push({ x1: b.x1 + n.x, y1: b.y1 + n.y, x2: b.x2 + n.x, y2: b.y2 + n.y, i: b.i >= 0 ? mp[b.i] : -1 }); });
      d.chart.knots.forEach(function (q) { knots.push({ x: q.x + n.x, y: q.y + n.y, i: q.i >= 0 ? mp[q.i] : -1, t: q.t }); });
      d.chart.part.forEach(function (q) { part.push({ x: q.x + n.x, y: q.y + n.y, a: q.a >= 0 ? mp[q.a] : -1, b: q.b >= 0 ? mp[q.b] : -1, d: q.d }); });
      d.pages.forEach(function (pg) {
        var c2 = deepCopy(pg);
        if (c2.region) { c2.region.x += n.x; c2.region.y += n.y; c2.region.fx = c2.region.fx; }
        c2.label = (parts.length > 1 && opts.labels && opts.labels[i] ? opts.labels[i] + ' · ' : '') + c2.label;
        pages.push(c2);
      });
    }
    for (k = 0; k < cells.length; k++) if (cells[k] >= 0) palette[cells[k]].stitchCount++;
    var out = normalize({
      fabric: first.fabric, design: { w: W, h: H, title: first.design.title, designer: first.design.designer, copyright: first.design.copyright },
      strandsDefault: first.strandsDefault, palette: palette,
      chart: { w: W, h: H, cells: cells, back: back, knots: knots, part: part },
      pages: pages, progress: { mode: 'cells', done: bytesToB64(done) },
      source: first.source
    }, null);
    return { data: out, w: W, h: H, maps: maps, conflicts: conflicts };
  }

  /* ---- #6 charts set in a symbol font, from the text layer ---------------- */

  /**
   * glyphCells(items, opts) -> [{ x, y, font, code }]
   * One entry per printed symbol, from pdf.js getTextContent().items (or
   * PdfText glyphs(): { font, code|unicode, box }). A multi-glyph item such as
   * "O O O O O" is split by the pitch: every non-space character is the next
   * square, spaces only separate them (an empty square is a wide " " item,
   * which is skipped). opts.fonts limits the fonts; opts.minSize / maxSize
   * keep only chart-sized text (the key's own symbols are bigger).
   * x, y: the symbol's left / baseline in page units (y up, pdf.js space).
   */
  function glyphCells(items, opts) {
    opts = isObj(opts) ? opts : {};
    items = Array.isArray(items) ? items : [];
    var out = [], fonts = isObj(opts.fonts) ? opts.fonts : null, i;
    var minS = num(opts.minSize, 0), maxS = num(opts.maxSize, 1e9);
    /* the pitch: the most common gap between rows of chart text */
    var pitch = num(opts.pitch, 0);
    var norm = [];
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      if (!isObj(it)) continue;
      var font = str(it.font || it.fontName, ''), s, x, y, size;
      if (it.transform) {
        s = str(it.str, ''); x = num(it.transform[4], 0); y = num(it.transform[5], 0);
        size = Math.abs(num(it.transform[0], 0)) || Math.abs(num(it.transform[3], 0));
      } else if (it.box) {
        s = str(it.unicode, '') || (it.code !== undefined ? String.fromCharCode(clampInt(it.code, 0, 65535, 32)) : '');
        x = num(it.box.x0, 0); y = -num(it.box.y1, 0); size = num(it.size, 0);
      } else continue;
      if (!s.replace(/\s+/g, '') || (fonts && !fonts[font]) || size < minS || size > maxS) continue;
      /* chart text is single symbols separated by spaces; "10" or "Page"
         (two characters side by side) is a ruler number or a word */
      if (/\S\S/.test(s)) continue;
      norm.push({ s: s, x: x, y: y, font: font, w: num(it.width, 0), size: size });
    }
    if (!pitch) {
      /* rows of symbols in different fonts sit a fraction of a point apart
         on their baselines: cluster them first, then take the commonest gap */
      var yl = [];
      for (i = 0; i < norm.length; i++) yl.push(norm[i].y);
      yl.sort(function (a, b) { return a - b; });
      var rowsY = [], acc = 0, cnt = 0;
      for (i = 0; i < yl.length; i++) {
        if (cnt && yl[i] - acc / cnt > 1.2) { rowsY.push(acc / cnt); acc = 0; cnt = 0; }
        acc += yl[i]; cnt++;
      }
      if (cnt) rowsY.push(acc / cnt);
      var gaps = {};
      for (i = 1; i < rowsY.length; i++) { var gk = Math.round((rowsY[i] - rowsY[i - 1]) * 10) / 10; if (gk > 1.2) gaps[gk] = (gaps[gk] || 0) + 1; }
      pitch = modeKey(gaps).value || 0;
      if (pitch > 0) {
        var fit = combFit(rowsY, pitch);
        if (fit && Math.abs(fit.pitch - pitch) < pitch * 0.1) pitch = fit.pitch;
      }
    }
    if (!(pitch > 0)) return out;
    for (i = 0; i < norm.length; i++) {
      var n = norm[i], k = 0;
      for (var c = 0; c < n.s.length; c++) {
        var ch = n.s.charAt(c);
        if (/\s/.test(ch)) continue;
        out.push({ x: n.x + k * pitch, y: n.y, font: n.font, code: ch, size: n.size });
        k++;
      }
    }
    out.pitch = pitch;
    return out;
  }

  /**
   * gridFromGlyphs(cells, key, opts) -> GridResult (the extractGrid shape:
   *   ok, w, h, cells:Int16Array, palette, check, unresolved, classes, glyphs,
   *   counts, filled, warnings, source:'text')
   * The squares of a chart printed in a symbol font, matched to the key by
   * the symbol itself: the same font and character (entry.symbolCode
   * { font, code }), else the same character the key printed (entry.symbol),
   * else the key's printed counts; anything else is an explicit
   * placeholder. opts.design { w, h } is the printed size (the lattice is
   * anchored at the bottom-right of the glyphs when it is larger).
   */
  function gridFromGlyphs(glyphs, key, opts) {
    opts = isObj(opts) ? opts : {};
    glyphs = Array.isArray(glyphs) ? glyphs : [];
    var warnings = [], i;
    var pitch = num(glyphs.pitch, num(opts.pitch, 0));
    var empty = { ok: false, w: 0, h: 0, cells: new Int16Array(0), palette: null, check: null, unresolved: [], classes: 0,
      glyphs: [], counts: [], filled: 0, colors: 0, matched: 0, warnings: warnings, source: 'text' };
    if (glyphs.length < 20 || !(pitch > 0)) { warnings.push('there is no chart set in a symbol font here'); return empty; }
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (i = 0; i < glyphs.length; i++) {
      x0 = Math.min(x0, glyphs[i].x); x1 = Math.max(x1, glyphs[i].x);
      y0 = Math.min(y0, glyphs[i].y); y1 = Math.max(y1, glyphs[i].y);
    }
    var W = Math.round((x1 - x0) / pitch) + 1, H = Math.round((y1 - y0) / pitch) + 1;
    var de = isObj(opts.design) ? opts.design : (isObj(key) && isObj(key.design) ? key.design : {});
    var dw = clampInt(de.w, 0, 20000, 0), dh = clampInt(de.h, 0, 20000, 0);
    var offX = 0, offY = 0;
    if (dw >= W && dh >= H && dw && dh) {
      /* the glyphs cover part of the printed size (unsymbolled colours, a
         margin of plain fabric): keep the printed size, centred on the glyphs */
      offX = Math.floor((dw - W) / 2); offY = Math.floor((dh - H) / 2);
      if (dw !== W || dh !== H) warnings.push('the symbols cover ' + W + ' × ' + H + ' of the printed ' + dw + ' × ' + dh + ' stitches');
      W = dw; H = dh;
    }
    if (W < 4 || H < 4 || W * H > 4000000) { warnings.push('the symbols do not form a chart grid'); return empty; }
    var ids = [], idIndex = {}, counts = [];
    var raw = new Int32Array(W * H), off = 0;
    for (i = 0; i < raw.length; i++) raw[i] = -1;
    for (i = 0; i < glyphs.length; i++) {
      var g = glyphs[i];
      var fx = (g.x - x0) / pitch, fy = (y1 - g.y) / pitch;
      var cx = Math.round(fx), cy = Math.round(fy);
      if (Math.abs(fx - cx) > 0.3 || Math.abs(fy - cy) > 0.3) { off++; continue; }
      var X2 = cx + offX, Y2 = cy + offY;
      if (X2 < 0 || Y2 < 0 || X2 >= W || Y2 >= H) continue;
      var id = g.font + '\u0001' + g.code;
      if (!idIndex.hasOwnProperty(id)) { idIndex[id] = ids.length; ids.push(id); counts.push(0); }
      if (raw[Y2 * W + X2] < 0) counts[idIndex[id]]++;
      raw[Y2 * W + X2] = idIndex[id];
    }
    if (off > glyphs.length * 0.05) warnings.push(off + ' symbols sat off the grid and were left out');
    var entries = isObj(key) && Array.isArray(key.entries) ? key.entries : [];
    /* match: font + code, then the printed character, then counts (nameClasses) */
    var pre = {}, used = {};
    for (i = 0; i < ids.length; i++) {
      var parts = ids[i].split('\u0001');
      for (var e = 0; e < entries.length; e++) {
        if (used[e] || !CHECK_KINDS[entries[e].kind || 'cross']) continue;
        var sc = entries[e].symbolCode;
        if (isObj(sc) && sc.font === parts[0] && sc.code === parts[1]) { pre[i] = e; used[e] = 1; break; }
      }
    }
    for (i = 0; i < ids.length; i++) {
      if (pre.hasOwnProperty(i)) continue;
      var ch2 = ids[i].split('\u0001')[1], hit = -1, nh = 0;
      for (var e2 = 0; e2 < entries.length; e2++) {
        if (used[e2] || !CHECK_KINDS[entries[e2].kind || 'cross']) continue;
        if (str(entries[e2].symbol, '') === ch2) { hit = e2; nh++; }
      }
      if (nh === 1) { pre[i] = hit; used[hit] = 1; }
    }
    /* the rest by counts, as a grid read does */
    var restIdx = [], restMarks = [];
    for (i = 0; i < ids.length; i++) if (!pre.hasOwnProperty(i)) { restIdx.push(i); restMarks.push({ id: ids[i], n: counts[i] }); }
    var restEntries = entries.map(function (en, k) { return used[k] ? { stitchCount: null, kind: 'used' } : en; });
    var map = restMarks.length ? matchGlyphs(restMarks, restEntries) : {};
    var palette = [], placeholders = [], classPal = [];
    for (i = 0; i < entries.length; i++) {
      var en2 = entries[i];
      var pe = normalizePaletteEntry({ i: i, symbol: en2.symbol || '', brand: en2.brand || 'DMC', code: en2.code, name: en2.name || '',
        hex: en2.hex || null, strands: en2.strands || (key && key.strandsDefault) || 2, kind: en2.kind || 'cross',
        stitchCount: 0, skeins: en2.skeins || 0 }, i, (key && key.strandsDefault) || 2);
      if (typeof en2.stitchCount === 'number' && en2.stitchCount > 0) pe.keyCount = en2.stitchCount;
      palette.push(pe);
    }
    var matched = 0, how = [];
    for (i = 0; i < ids.length; i++) {
      var t = pre.hasOwnProperty(i) ? pre[i] : (map[ids[i]] !== undefined && restEntries[map[ids[i]]].kind !== 'used' ? map[ids[i]] : -1);
      if (t >= 0) { classPal[i] = t; matched++; how.push(pre.hasOwnProperty(i) ? 'symbol' : 'count'); continue; }
      var unusedCross = [];
      for (var q = 0; q < entries.length; q++) {
        if (CHECK_KINDS[entries[q].kind || 'cross'] && !used[q] && classPal.indexOf(q) < 0) unusedCross.push(q);
      }
      var pIdx = palette.length;
      palette.push({ i: pIdx, symbol: ids[i].split('\u0001')[1], brand: '', code: '', name: 'Symbol "' + ids[i].split('\u0001')[1] + '" (not in the key?)',
        hex: '808080', strands: (key && key.strandsDefault) || 2, bsStrands: 1, kind: 'cross', blendWith: null,
        stitchCount: 0, skeins: 0, have: false, unresolved: unusedCross.slice(0, 8) });
      placeholders.push({ palette: pIdx, ink: ids[i], cells: counts[i], candidates: unusedCross.slice(0, 8), expected: [], why: 'unknown' });
      classPal[i] = pIdx;
      how.push(null);
    }
    var cells = new Int16Array(W * H), filled = 0;
    for (i = 0; i < raw.length; i++) {
      cells[i] = raw[i] < 0 ? -1 : classPal[raw[i]];
      if (raw[i] >= 0) { filled++; palette[cells[i]].stitchCount++; }
    }
    var noSymbol = [];
    for (i = 0; i < entries.length; i++) {
      if (CHECK_KINDS[entries[i].kind || 'cross'] && !palette[i].stitchCount) noSymbol.push(i);
    }
    if (noSymbol.length) warnings.push(noSymbol.length + ' ' + plural(noSymbol.length, 'key colour') + ' ' +
      plural(noSymbol.length, 'has', 'have') + ' no symbol in the chart text (' +
      noSymbol.map(function (q) { return flossLabel(entries[q]); }).join(', ') + '): those squares are not read');
    var check = checkCounts(normalize({ palette: palette, chart: { w: W, h: H, cells: cells } }, null), entries);
    return {
      ok: filled > 0 && matched > 0, w: W, h: H, cells: cells, palette: palette, check: check,
      unresolved: placeholders, classes: ids.length, glyphs: ids.slice(), counts: counts.slice(),
      how: how, filled: filled, colors: ids.length, matched: matched, missing: noSymbol, pitch: pitch,
      warnings: warnings, source: 'text'
    };
  }

  /**
   * keySymbolCodes(items, entries, opts) -> entries (each copy gains
   * symbolCode { font, code } when a key-sized symbol sits on its row).
   * Rows are matched by the baseline of the entry's code in the text layer.
   */
  function keySymbolCodes(items, entries, opts) {
    opts = isObj(opts) ? opts : {};
    items = Array.isArray(items) ? items : [];
    var out = (Array.isArray(entries) ? entries : []).map(function (e) { return deepCopy(e); });
    var codes = [], syms = [], i;
    var minS = num(opts.minSize, 8);
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      if (!isObj(it) || !it.transform) continue;
      var s = str(it.str, '').trim(), size = Math.abs(num(it.transform[0], 0));
      if (!s) continue;
      var rec = { s: s, x: num(it.transform[4], 0), y: num(it.transform[5], 0), font: str(it.fontName, ''), size: size };
      if (s.length === 1 && size >= minS) syms.push(rec);
      codes.push(rec);
    }
    for (var e = 0; e < out.length; e++) {
      var code = str(out[e].code, '');
      if (!code) continue;
      var row = null;
      for (i = 0; i < codes.length; i++) if (codes[i].s === code) { row = codes[i]; break; }
      if (!row) continue;
      var best = null, bd = Infinity;
      for (i = 0; i < syms.length; i++) {
        var dy = Math.abs(syms[i].y - row.y);
        if (dy < row.size * 0.8 && syms[i].x < row.x && dy < bd) { bd = dy; best = syms[i]; }
      }
      if (best) out[e].symbolCode = { font: best.font, code: best.s };
    }
    return out;
  }

  /* ---- end of wave K section ---- */

  /* ================================================================== *
   * 11. Exports and registration
   * ================================================================== */

  window.XStitch = {
    /* craft plumbing */
    normalize: normalize,
    summary: summary,
    TEMPLATES: TEMPLATES,

    /* floss + colour */
    FLOSS: FLOSS,
    hexFor: hexFor,
    flossFor: flossFor,
    nearestFloss: nearestFloss,
    rgbToLab: rgbToLab,
    hexToRgb: hexToRgb,
    hexToLab: hexToLab,
    deltaE76: deltaE76,
    deltaE2000: deltaE2000,

    /* symbols */
    SYMBOLS: SYMBOLS,
    assignSymbols: assignSymbols,
    symbolInk: symbolInk,

    /* packing */
    packCells: packCells,
    unpackCells: unpackCells,
    packBits: packBits,
    unpackBits: unpackBits,
    getBit: getBit,
    setBit: setBit,
    bitsState: bitsState,
    bitsB64: bitsB64,
    countBits: countBits,
    refitBits: refitBits,

    /* geometry + floss maths */
    finishedSize: finishedSize,
    sizeTable: sizeTable,
    lengthPerStitchCm: lengthPerStitchCm,
    skeinsFor: skeinsFor,
    skeinRange: skeinRange,
    confetti: confetti,
    progressStats: progressStats,

    /* backstitch / knot / fractional tracking */
    nearestBack: nearestBack,
    nearestKnot: nearestKnot,
    nearestPart: nearestPart,
    tapLayer: tapLayer,
    tapCaption: tapCaption,
    TAP_ORDER: TAP_ORDER,
    TAP_CAPTIONS: TAP_CAPTIONS,
    HIT_TOL: HIT_TOL,

    /* chart position (wave F) */
    centreOffset: centreOffset,
    positionLabel: positionLabel,
    rulerStep: rulerStep,
    pageForCell: pageForCell,
    nearestCellOf: nearestCellOf,
    nextStitchNear: nextStitchNear,
    VIEW_MAX_Z: VIEW_MAX_Z,

    /* storage guard (B9 risk #4) */
    dataSize: dataSize,
    toCountsMode: toCountsMode,
    SIZE_WARN_BYTES: SIZE_WARN_BYTES,
    SIZE_BUDGET_BYTES: SIZE_BUDGET_BYTES,

    /* import / export */
    parseOXS: parseOXS,
    toOXS: toOXS,
    parseKey: parseKey,
    extractGrid: extractGrid,
    printableHTML: printableHTML,

    /* wave J: the key as a checksum, and written instructions */
    designSize: designSize,
    checkCounts: checkCounts,
    writtenRows: writtenRows,
    rowText: rowText,
    rowDone: rowDone,
    cellsOfRow: cellsOfRow,
    fmtInt: fmtInt,

    /* wave K (xs-core): docs/wave-k/api/xs-core.md */
    WAVE_K: 1,
    resolveClass: resolveClass,
    glyphFromPolys: glyphFromPolys,
    totals: totals,
    pctText: pctText,
    symbolCheck: symbolCheck,
    skeinPlan: skeinPlan,
    bulkPlan: bulkPlan,
    CONFIRM_ABOVE: CONFIRM_ABOVE,
    parkAt: parkAt,
    unpark: unpark,
    parkedAt: parkedAt,
    nextBlockFor: nextBlockFor,
    parkingOrder: parkingOrder,
    cellsOfPage: cellsOfPage,
    pageProgress: pageProgress,
    islands: islands,
    islandRoute: islandRoute,
    islandAt: islandAt,
    templateFromProject: templateFromProject,
    ornamentsFromGraphics: ornamentsFromGraphics,
    sessionLines: sessionLines,
    dayStrip: dayStrip,
    findPlace: findPlace,
    goalProgress: goalProgress,
    markDiff: markDiff,
    replayMarks: replayMarks,
    flossId: flossId,
    flossNeeds: flossNeeds,
    kitList: kitList,
    registerBrandTable: registerBrandTable,
    brandTables: brandTables,
    convert: convert,
    substitutes: substitutes,
    fabricPlan: fabricPlan,
    frameFit: frameFit,
    KINDS: KINDS,
    kindOf: kindOf,
    materials: materials,
    filetRowText: filetRowText,
    quadrantLayout: quadrantLayout,
    joinCharts: joinCharts,
    glyphCells: glyphCells,
    gridFromGlyphs: gridFromGlyphs,
    keySymbolCodes: keySymbolCodes,

    /* internals, exposed for test/xstitch.test.html only */
    _key: {
      brandColumnHeader: brandColumnHeader,
      splitBrandGlued: splitBrandGlued,
      decomposeCodes: decomposeCodes,
      stripChartSoup: stripChartSoup,
      countColumnAt: countColumnAt,
      skeinColumnAt: skeinColumnAt,
      zipCountColumns: zipCountColumns,
      zipColumn: zipColumn,
      openRuns: openRuns,
      nameColumnAt: nameColumnAt,
      zipNameColumn: zipNameColumn,
      trailingCodeRow: trailingCodeRow,
      tidyName: tidyName,
      cleanKeyLine: cleanKeyLine,
      expandCountColumns: expandCountColumns,
      flossListRow: flossListRow,
      flossListHeader: flossListHeader,
      keyHexFor: keyHexFor
    },

    _grid: {
      combFit: combFit,
      latticeOf: latticeOf,
      placeTile: placeTile,
      matchGlyphs: matchGlyphs,
      collectGlyphs: collectGlyphs,
      /* wave K */
      collectRects: collectRects,
      pdfOps: pdfOps,
      mergeTile: mergeTile,
      pickK: pickK,
      tileSigs: tileSigs,
      tileDots: tileDots,
      legendOf: legendOf,
      shapeMask: shapeMask,
      maskDist: maskDist,
      sigGroups: sigGroups,
      nameClasses: nameClasses,
      solveCluster: solveCluster,
      glyphFromPolys: glyphFromPolys,
      unitPolys: unitPolys,
      SIG_N: SIG_N
    }
  };

  /* Registers with the shell when it is present; the file also loads
     standalone in a test page. */
  if (window.Store && typeof window.Store.registerCraft === 'function') {
    try {
      window.Store.registerCraft({
        id: 'crossstitch',
        normalize: normalize,
        summary: summary,
        templates: TEMPLATES,
        /* Wave K (#18, shell-data §4): the two big strings live in
           IndexedDB once they pass 32 KB; normalize keeps the same `data`
           string, so opening a project rewrites nothing. */
        heavy: { fields: ['chart.cells.data', 'progress.done'], minBytes: 32768 },
        template: { fromProject: templateFromProject }
      });
    } catch (e) { /* never break the shell */ }
  }

})();
