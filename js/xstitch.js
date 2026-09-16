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
    '158|Cornflower Blu Medium Very Dark|4c526e',
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

  function buildFlossTable(raw) {
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var p = raw[i].split('|');
      var hex = p[2];
      out.push({
        code: p[0],
        name: p[1],
        hex: hex,
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16)
      });
    }
    return out;
  }

  var FLOSS = { dmc: buildFlossTable(FLOSS_DMC_RAW) };

  /* code -> entry, for hexFor(). Keys are lowercased. */
  var DMC_BY_CODE = {};
  (function () {
    for (var i = 0; i < FLOSS.dmc.length; i++) {
      DMC_BY_CODE[FLOSS.dmc[i].code.toLowerCase()] = FLOSS.dmc[i];
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

  function canonDmcCode(code) {
    var c = String(code == null ? '' : code).trim().toLowerCase();
    if (!c) return '';
    if (DMC_ALIASES[c]) return DMC_ALIASES[c];
    if (DMC_BY_CODE[c]) return c;
    // '0310' and '310 ' style noise
    var stripped = c.replace(/^0+(?=\d)/, '');
    if (DMC_BY_CODE[stripped]) return stripped;
    return c;
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

    for (var k = 0; k < order.length; k++) {
      var idx = order[k].i;
      var p = pos[idx];
      var before = p > 0 ? assignedAt[p - 1] : null;
      var after = p < n - 1 ? assignedAt[p + 1] : null;
      var pick = null, fallback = null;
      for (var s = 0; s < pool.length; s++) {
        var g = pool[s];
        if (used[g]) continue;
        if (fallback === null) fallback = g;
        var f = familyOf(g);
        if (before && familyOf(before) === f) continue;
        if (after && familyOf(after) === f) continue;
        pick = g;
        break;
      }
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

  /** skeinRange(args) -> { low, high } — an honest range, not false precision. */
  function skeinRange(o) {
    o = isObj(o) ? o : {};
    var high = skeinsFor(o);
    if (!high) return { low: 0, high: 0 };
    var stitches = num(o.stitchCount, 0);
    var waste = num(o.waste, 0.2);
    if (!(waste >= 0)) waste = 0;
    var len = lengthPerStitchCm(o.count, o.over);
    var per = usableCm(o.strands) * SKEIN_SPREAD;
    var low = Math.ceil(stitches * len * (1 + waste) / per);
    if (low < 1) low = 1;
    if (low > high) low = high;
    return { low: low, high: high };
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
   * progressStats(data) -> { done, total, pct, byColor: [{ i, done, total }] }
   * Works in both 'cells' and 'counts' mode.
   */
  function progressStats(data) {
    data = isObj(data) ? data : {};
    var palette = Array.isArray(data.palette) ? data.palette : [];
    var progress = isObj(data.progress) ? data.progress : {};
    var byColor = [];
    var i, done = 0, total = 0;

    var c = progress.mode === 'cells' ? chartCells(data.chart) : null;
    if (c) {
      var n = c.w * c.h;
      var bits = unpackBits(str(progress.done, ''), n);
      var dTot = [], tTot = [];
      for (i = 0; i < palette.length; i++) { dTot.push(0); tTot.push(0); }
      for (i = 0; i < n; i++) {
        var v = c.cells[i];
        if (v < 0) continue;
        total++;
        if (v < tTot.length) tTot[v]++;
        if (bits[i]) {
          done++;
          if (v < dTot.length) dTot[v]++;
        }
      }
      for (i = 0; i < palette.length; i++) {
        byColor.push({ i: num(palette[i].i, i), done: dTot[i], total: tTot[i] });
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
        total += t;
        done += d;
        byColor.push({ i: num(palette[i].i, i), done: d, total: t });
      }
    }

    return {
      done: done,
      total: total,
      pct: total > 0 ? Math.round(done / total * 100) : 0,
      byColor: byColor
    };
  }

  /* ================================================================== *
   * 7. Craft plumbing (B3.1)
   * ================================================================== */

  var FABRIC_KINDS = { aida: 1, evenweave: 1, linen: 1 };
  var PALETTE_KINDS = { cross: 1, back: 1, knot: 1, bead: 1, half: 1, blend: 1 };
  var SOURCE_KINDS = { oxs: 1, pdf: 1, photo: 1, manual: 1 };
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
    return {
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

  /**
   * normalize(raw, project) -> XSData
   * Never throws. Repairs or creates every field in the B2 data model.
   */
  function normalize(raw, project) {
    var d = isObj(raw) ? raw : {};
    var out = { v: 1 };

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
          isChart: q.isChart === undefined ? true : !!q.isChart
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
      perColor: perColor,
      pageDone: pageDone,
      blocks: blocks
    };
    if (mode === 'cells') {
      var st = progressStats(out);
      out.progress.doneCount = st.done;
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
      zoom: num(cu.zoom, 1) > 0 ? num(cu.zoom, 1) : 1
    };

    /* parking */
    var parking = [];
    if (Array.isArray(d.parking)) {
      for (var pk = 0; pk < d.parking.length; pk++) {
        var park = d.parking[pk];
        if (!isObj(park)) continue;
        var corner = park.corner;
        parking.push({
          key: str(park.key, ''),
          symbol: str(park.symbol, ''),
          corner: (corner === 'tl' || corner === 'tr' || corner === 'bl' || corner === 'br') ? corner : 'tl',
          note: str(park.note, '')
        });
      }
    }
    out.parking = parking;

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
      var doneColors = 0;
      for (var i = 0; i < stats.byColor.length; i++) {
        var c = stats.byColor[i];
        if (c.total > 0 && c.done >= c.total) doneColors++;
      }
      parts.push(doneColors + ' of ' + palette.length + ' colour' + (palette.length === 1 ? '' : 's'));
    } else if (design.w && design.h) {
      parts.push(design.w + ' × ' + design.h + ' stitches');
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
      if (type === 'knot' || type === 'frenchknot' || type === 'french_knot') {
        knots.push({ x: ox, y: oy, i: oi, t: 'knot' });
      } else if (type === 'bead' || type === 'button' || type === 'sequin' ||
                 type === 'treasure' || type === 'charm') {
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

  /** Normalise a raw line for tokenising: leader dots, pipes, digit groups. */
  function cleanKeyLine(line) {
    var s = String(line == null ? '' : line);
    s = s.replace(/ | | | /g, ' ');
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

  var SECTION_TESTS = [
    { kind: 'back', re: /back\s*stitch|backstitch|^b\.?\s*s\.?$/i },
    { kind: 'knot', re: /french\s*knot/i },
    { kind: 'bead', re: /\bbead/i },
    { kind: 'half', re: /half\s*stitch|petite|fractional|quarter\s*stitch/i },
    { kind: 'cross', re: /cross\s*stitch|full\s*stitch/i }
  ];

  function sectionKindFor(line) {
    var s = line.trim();
    if (!s || s.length > 48) return null;
    for (var i = 0; i < SECTION_TESTS.length; i++) {
      if (SECTION_TESTS[i].re.test(s)) return SECTION_TESTS[i].kind;
    }
    return null;
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
      confidence: 0,
      warnings: warnings
    };

    var raw = typeof text === 'string' ? text : '';
    if (!raw.replace(/\s+/g, '')) {
      pushOnce(warnings, 'no text in this file');
      return result;
    }

    var rawLines = raw.split(/\r\n|\r|\n/);

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

    for (var li = 0; li < rawLines.length; li++) {
      var rawLine = rawLines[li];
      if (/^\s*={2,}\s*PAGE\b/i.test(rawLine)) continue;         // PdfText page marker
      // page furniture: '(c) 2026 A Stitcher' would otherwise read as code 2026
      if (/©|\(c\)|copyright|all rights reserved/i.test(rawLine)) continue;
      if (!rawLine.replace(/\s+/g, '')) {
        blankRun++;
        if (blankRun >= 2) kind = 'cross';
        continue;
      }
      blankRun = 0;

      var entry = parseKeyRow(rawLine, kind, brandRe, docBrand, defaultStrands);
      if (entry) {
        if (entry.symbolUnreadable) anyUnreadable = true;
        delete entry.symbolUnreadable;
        var mk = (entry.brand || '') + ' ' + entry.code.toLowerCase() + ' ' + entry.kind;
        if (byKey[mk]) {
          var prev = byKey[mk];
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
        } else {
          byKey[mk] = entry;
          entries.push(entry);
        }
        continue;
      }

      var sk = sectionKindFor(rawLine);
      if (sk) kind = sk;
    }

    for (var ei = 0; ei < entries.length; ei++) {
      var e = entries[ei];
      if (e.hex === null && (e.brand === 'DMC' || e.brand === '')) {
        if (/^4\d{3}$/.test(e.code)) pushOnce(warnings, 'variegated colours are approximate on screen');
        else pushOnce(warnings, 'no colour data for ' + (e.brand || 'DMC') + ' ' + e.code);
      } else if (e.hex === null && e.brand) {
        pushOnce(warnings, 'no colour data for ' + e.brand + ' threads');
      }
    }
    if (anyUnreadable) pushOnce(warnings, 'symbols unreadable');
    result.entries = entries;

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
      if (result.fabric.over === null && /over\s*(?:2|two)\b/i.test(line)) result.fabric.over = 2;
      if (result.fabric.kind === null) {
        if (/\baida\b/i.test(line)) result.fabric.kind = 'aida';
        else if (/\bevenweave\b|\blugana\b|\bjobelan\b/i.test(line)) result.fabric.kind = 'evenweave';
        else if (/\blinen\b|\bbelfast\b|\bcashel\b/i.test(line)) result.fabric.kind = 'linen';
      }

      if (result.design.w === null) {
        m = /stitch(?:es)?\s*count\s*:?\s*(\d+)\s*(?:w|x|×|wide|by)\s*(\d+)/i.exec(line) ||
            /(\d+)\s*(?:w|wide)\s*(?:x|×|by)\s*(\d+)\s*(?:h|high)/i.exec(line) ||
            /design\s*(?:area|size)\s*:?\s*(\d+)\s*(?:x|×)\s*(\d+)/i.exec(line);
        if (m) {
          result.design.w = parseInt(m[1], 10);
          result.design.h = parseInt(m[2], 10);
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

    /* strandsDefault: a strand hint near "cross stitch" wins, else any hint */
    var strandHint = null;
    for (i = 0; i < rawLines.length; i++) {
      line = rawLines[i];
      m = /(\d)\s*strands?\b/i.exec(line);
      if (!m) continue;
      var v = parseInt(m[1], 10);
      if (!(v >= 1 && v <= 6)) continue;
      if (/cross\s*stitch/i.test(line)) { strandHint = v; break; }
      if (strandHint === null) strandHint = v;
    }
    if (strandHint !== null) result.strandsDefault = strandHint;

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

    /* ---------------- confidence (B3.3 step 6) ---------------- */
    var nEntries = entries.length;
    var withCount = 0, withSymbol = 0;
    for (i = 0; i < nEntries; i++) {
      if (entries[i].stitchCount !== null) withCount++;
      if (entries[i].symbol) withSymbol++;
    }
    var conf = 0;
    if (nEntries >= 3) conf += 0.4;
    if (result.design.w && result.design.h) conf += 0.2;
    if (result.fabric.count) conf += 0.2;
    if (nEntries && withCount / nEntries >= 0.6) conf += 0.1;
    if (nEntries && withSymbol / nEntries >= 0.6) conf += 0.1;
    result.confidence = nEntries ? Math.round(conf * 100) / 100 : 0;

    if (!nEntries) pushOnce(warnings, 'no colour key found');
    return result;
  }

  /* One key row, or null when the line is not a key row. */
  function parseKeyRow(rawLine, kind, brandRe, docBrand, defaultStrands) {
    var cleaned = cleanKeyLine(rawLine);
    if (!cleaned) return null;
    if (cleaned.length > 160) return null;

    var toks = tokenizeKeyLine(cleaned);
    if (!toks.length) return null;

    /* blend, spotted before tokens are consumed */
    var blendCode = null;
    var bm = /\b(\d{3,5}|B5200|Blanc|Ecru|White)\s*(?:\+|\/|&|\band\b)\s*(\d{3,5}|B5200|Blanc|Ecru|White)\b/i.exec(cleaned);

    var i = 0, symbol = '', brand = '';
    while (i < toks.length) {
      var t = toks[i];
      if (!brand && brandRe.test(t)) { brand = canonBrand(t) || t; i++; continue; }
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
    var hex = hexFor(lookupBrand, code);

    /* Reject prose: a bare short number with no brand and no DMC match is
       almost always "2 strands throughout" or a margin ruler. A document-level
       brand (an Anchor-only chart) vouches for two-digit codes too. */
    var codeOk = !!hex || !!brand || NAMED_CODE_RE.test(code) ||
      /^\d{3,5}$/.test(code) || (!!docBrand && /^\d{2,5}$/.test(code));
    if (!codeOk) return null;

    /* ---- name + trailing numbers ---- */
    var rest = toks.slice(i);
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
    for (k = 0; k < labelled.length; k++) {
      var L = labelled[k];
      if (L.unit === 'strands' && have.strands === null) have.strands = L.v;
      else if (L.unit === 'stitches' && have.stitchCount === null) have.stitchCount = L.v;
      else if (L.unit === 'skeins' && have.skeins === null) have.skeins = L.v;
      else if (L.unit === null) unlabelled.push(L.v);
    }

    var fit = fitNums(unlabelled, have);
    var name = nameToks.concat(fit.extra.map(String)).join(' ')
      .replace(/^[-:|\s]+/, '').replace(/[-:|\s]+$/, '').trim();

    /* prose guard: key rows are short */
    var nameWords = name ? name.split(/\s+/).length : 0;
    if (nameWords > 8) return null;
    if (!name && fit.strands === null && fit.stitchCount === null && fit.skeins === null) return null;

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
      symbolUnreadable: unreadable
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

  /* 'in', 'inch', 'inches' or a double-quote mark */
  var IN = '(?:in\\b|inch(?:es)?\\b|")';

  function sizeRowFrom(line) {
    /* '5.1" x 5.1" on 14 ct' — the unit after the first number */
    var m = new RegExp('(\\d+(?:\\.\\d+)?)\\s*' + IN + '\\s*(?:x|\u00D7)\\s*(\\d+(?:\\.\\d+)?)\\s*' + IN + '?[^\\n]*?(\\d{2})\\s*(?:ct\\b|count\\b)', 'i').exec(line);
    if (m) return { count: parseInt(m[3], 10), wIn: round2(parseFloat(m[1])), hIn: round2(parseFloat(m[2])) };

    /* '6.36 x 5.29 in on 14 ct' — the unit only after the second number */
    m = new RegExp('(\\d+(?:\\.\\d+)?)\\s*(?:x|\u00D7)\\s*(\\d+(?:\\.\\d+)?)\\s*' + IN + '[^\\n]*?(\\d{2})\\s*(?:ct\\b|count\\b)', 'i').exec(line);
    if (m) return { count: parseInt(m[3], 10), wIn: round2(parseFloat(m[1])), hIn: round2(parseFloat(m[2])) };

    m = new RegExp('(\\d{2})\\s*(?:ct\\b|count\\b)[^\\n]*?(\\d+(?:\\.\\d+)?)\\s*' + IN + '?\\s*(?:x|\u00D7)\\s*(\\d+(?:\\.\\d+)?)\\s*' + IN, 'i').exec(line);
    if (m) return { count: parseInt(m[1], 10), wIn: round2(parseFloat(m[2])), hIn: round2(parseFloat(m[3])) };

    m = /(\d+(?:\.\d+)?)\s*cm\s*(?:x|×)\s*(\d+(?:\.\d+)?)\s*cm[^\n]*?(\d{2})\s*(?:ct\b|count\b)/i.exec(line);
    if (m) return { count: parseInt(m[3], 10), wIn: round2(parseFloat(m[1]) / CM_PER_IN), hIn: round2(parseFloat(m[2]) / CM_PER_IN) };

    m = /(\d{2})\s*(?:ct\b|count\b)[^\n]*?(\d+(?:\.\d+)?)\s*(?:cm)?\s*(?:x|×)\s*(\d+(?:\.\d+)?)\s*cm/i.exec(line);
    if (m) return { count: parseInt(m[1], 10), wIn: round2(parseFloat(m[2]) / CM_PER_IN), hIn: round2(parseFloat(m[3]) / CM_PER_IN) };

    return null;
  }

  var STITCH_TYPES = [
    { name: 'cross stitch', re: /cross\s*stitch/i },
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
   * 10. Stubs
   * ================================================================== */

  /**
   * extractGrid(pdfDoc, pageNo, opts) -> Promise<{ ok, warnings, ... }>
   * TODO(B3.4): the "Try to read the grid (beta)" path — histogram the text
   * item positions into a lattice, snap glyphs to cells, and accept only when
   * the recovered per-symbol counts agree with the key's stitchCount column
   * within 2% on at least 80% of colours. Deliberately not the v1 promise.
   */
  function extractGrid() {
    return Promise.resolve({ ok: false, warnings: ['not implemented'] });
  }

  /**
   * printableHTML(data, opts) -> string
   * TODO(B7): a self-contained printable page — cover block (title, size
   * table, fabric, floss list with skein ranges), then chart pages tiled at a
   * chosen stitches-per-page with 10x10 majors, margin numbering every 10,
   * centre arrows and a repeated key. Built in phase 2 with the chart
   * renderer, so the two share one cell-drawing routine.
   */
  function printableHTML() {
    return '';
  }

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

    /* geometry + floss maths */
    finishedSize: finishedSize,
    sizeTable: sizeTable,
    lengthPerStitchCm: lengthPerStitchCm,
    skeinsFor: skeinsFor,
    skeinRange: skeinRange,
    confetti: confetti,
    progressStats: progressStats,

    /* import / export */
    parseOXS: parseOXS,
    toOXS: toOXS,
    parseKey: parseKey,
    extractGrid: extractGrid,
    printableHTML: printableHTML
  };

  /* Registers with the shell when it is present; the file also loads
     standalone in a test page. */
  if (window.Store && typeof window.Store.registerCraft === 'function') {
    try {
      window.Store.registerCraft({
        id: 'crossstitch',
        normalize: normalize,
        summary: summary,
        templates: TEMPLATES
      });
    } catch (e) { /* never break the shell */ }
  }

})();
