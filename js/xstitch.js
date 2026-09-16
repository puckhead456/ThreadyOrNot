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

  /**
   * A page footer glued onto the row beneath it, which is what a generator
   * that prints "38 / 38" in the margin produces when the two run together:
   *   '38 / 383756 (905 ct)'  ->  '3756 (905 ct)'
   * Only fires when the second number starts with the first one and leaves a
   * plausible floss code behind, so a real '10 / 38' is left alone.
   */
  function stripFooterGlue(s) {
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

    var codes = [], marks = [], i;
    for (i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (/^x$/i.test(t)) {
        var next = toks[i + 1];
        if (next && /^\d{1,3}$/.test(next)) { marks.push(parseInt(next, 10)); i++; continue; }
        return null;
      }
      if (isCodeToken(t)) { codes.push(t); continue; }
      if (/^\d{1,2}$/.test(t)) continue;          // a stray column number
      return null;                                 // a word: not this shape
    }
    if (!codes.length) return [];

    if (!marks.length) {
      // No 'x N' anywhere: only trust a run of numbers when the sheet has
      // told us how many skeins every colour takes, and every number is a
      // floss we actually know.
      if (!allowBare || codes.length < 2) return null;
      for (i = 0; i < codes.length; i++) if (!hexFor('DMC', codes[i])) return null;
    }

    var skeins = marks.length ? marks[marks.length - 1] : null;
    var out = [];
    for (i = 0; i < codes.length; i++) out.push({ code: codes[i], skeins: skeins });
    return out;
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
      declaredColors: null,
      bsStrands: null,
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
    var inBlock = false;

    /* Document-level facts the row parser needs before it starts. */
    var mEach = SKEIN_EACH_RE.exec(raw);
    var defaultSkeins = mEach ? parseInt(mEach[1], 10) : null;

    /** Add a row, merging it onto an earlier row for the same floss. */
    function addEntry(entry) {
      var mk = (entry.brand || '') + ' ' + entry.code.toLowerCase() + ' ' + entry.kind;
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

    for (var li = 0; li < rawLines.length; li++) {
      var rawLine = rawLines[li];
      if (/^\s*={2,}\s*PAGE\b/i.test(rawLine)) {                 // PdfText page marker
        inBlock = false;
        continue;
      }
      // page furniture: '(c) 2026 A Stitcher' would otherwise read as code 2026
      if (/©|\(c\)|copyright|all rights reserved/i.test(rawLine)) continue;
      if (!rawLine.replace(/\s+/g, '')) {
        blankRun++;
        if (blankRun >= 2) { kind = 'cross'; inBlock = false; }
        continue;
      }
      blankRun = 0;

      if (KEY_BLOCK_BREAK_RE.test(rawLine)) inBlock = false;
      else if (KEY_BLOCK_HEADER_RE.test(rawLine)) inBlock = true;

      /* The bare-numbers legend shapes first: they never look like prose. */
      var listed = codeListRow(rawLine, defaultSkeins !== null);
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
            hex: hexFor(lBrand, lCode), line: String(rawLine).trim()
          });
        }
        continue;
      }
      if (listed) continue;   // recognised as a legend line, but no codes on it

      var entry = parseKeyRow(rawLine, kind, brandRe, docBrand, defaultStrands, inBlock);
      if (entry) {
        if (entry.symbolUnreadable) anyUnreadable = true;
        delete entry.symbolUnreadable;
        addEntry(entry);
        continue;
      }

      var sk = sectionKindFor(rawLine);
      if (sk) kind = sk;
    }

    /* '* 1 skein in each colour' fills in every row that had no number. */
    if (defaultSkeins !== null) {
      for (var de = 0; de < entries.length; de++) {
        if (entries[de].skeins === null) entries[de].skeins = defaultSkeins;
      }
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

    /* strandsDefault: a strand hint near "cross stitch" wins, else any hint.
       Backstitch lines are counted separately; when a sheet contradicts
       itself (the DMC library ones do, because the FR and EN columns bleed
       together) the smaller number is the safer one for backstitch. */
    var strandHint = null;
    var bsHint = null;
    for (i = 0; i < rawLines.length; i++) {
      line = rawLines[i];
      m = STRAND_RE.exec(line);
      if (!m) continue;
      var v = parseInt(m[1], 10);
      if (!(v >= 1 && v <= 6)) continue;
      if (/back\s*stitch|point\s*arri/i.test(line)) {
        if (bsHint === null || v < bsHint) bsHint = v;
        continue;
      }
      if (/cross\s*stitch|point\s*de\s*croix/i.test(line)) { strandHint = v; continue; }
      if (strandHint === null) strandHint = v;
    }
    if (strandHint !== null) result.strandsDefault = strandHint;
    if (bsHint !== null) result.bsStrands = bsHint;

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
    if (EMBROIDERY_STITCH_RE.test(raw) && !/cross\s*stitch|point\s*de\s*croix/i.test(raw) &&
        !/\baida\b/i.test(raw) && !result.fabric.count) {
      pushOnce(warnings, 'this looks like an embroidery pattern, not a counted chart');
      if (result.confidence > 0.2) result.confidence = 0.2;
    }

    if (!nEntries) pushOnce(warnings, 'no colour key found');
    return result;
  }

  /* One key row, or null when the line is not a key row. */
  function parseKeyRow(rawLine, kind, brandRe, docBrand, defaultStrands, inBlock) {
    var cleaned = cleanKeyLine(rawLine);
    if (!cleaned) return null;
    if (cleaned.length > 160) return null;

    var toks = tokenizeKeyLine(cleaned);
    if (!toks.length) return null;

    // Chart furniture, whatever the surrounding context.
    if (looksLikeGridLine(toks)) return null;
    // Any other bare run of numbers needs a key header to vouch for it.
    if (!inBlock && allIntegers(toks)) return null;

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
    var name = nameToks.concat(fit.extra.map(String)).join(' ')
      .replace(/^[-:|\s]+/, '').replace(/[-:|\s]+$/, '').trim();

    /* prose guard: key rows are short */
    var nameWords = name ? name.split(/\s+/).length : 0;
    if (nameWords > 8) return null;
    if (!name && fit.strands === null && fit.stitchCount === null && fit.skeins === null) return null;

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

  /* Built once: parseKey runs these over every line of a 100 kB extraction,
     and `new RegExp` per line was the single most expensive thing it did. */
  var SIZE_RES = [
    /* '5.1" x 5.1" on 14 ct' — the unit after the first number */
    { re: new RegExp('(\\d+(?:\\.\\d+)?)\\s*' + IN + '\\s*(?:x|\u00D7)\\s*(\\d+(?:\\.\\d+)?)\\s*' + IN + '?[^\\n]*?(\\d{2})\\s*(?:ct\\b|count\\b)', 'i'), c: 3, w: 1, h: 2, cm: false },
    /* '6.36 x 5.29 in on 14 ct' — the unit only after the second number */
    { re: new RegExp('(\\d+(?:\\.\\d+)?)\\s*(?:x|\u00D7)\\s*(\\d+(?:\\.\\d+)?)\\s*' + IN + '[^\\n]*?(\\d{2})\\s*(?:ct\\b|count\\b)', 'i'), c: 3, w: 1, h: 2, cm: false },
    /* '14 ct: 6.36 x 5.29 inches' */
    { re: new RegExp('(\\d{2})\\s*(?:ct\\b|count\\b)[^\\n]*?(\\d+(?:\\.\\d+)?)\\s*' + IN + '?\\s*(?:x|\u00D7)\\s*(\\d+(?:\\.\\d+)?)\\s*' + IN, 'i'), c: 1, w: 2, h: 3, cm: false },
    /* '71.12 cm x 91.44 cm (16 ct./inch)' */
    { re: new RegExp('(\\d+(?:\\.\\d+)?)\\s*cm\\s*(?:x|\u00D7)\\s*(\\d+(?:\\.\\d+)?)\\s*cm[^\\n]*?(\\d{2})\\s*(?:ct\\b|count\\b)', 'i'), c: 3, w: 1, h: 2, cm: true },
    { re: new RegExp('(\\d{2})\\s*(?:ct\\b|count\\b)[^\\n]*?(\\d+(?:\\.\\d+)?)\\s*(?:cm)?\\s*(?:x|\u00D7)\\s*(\\d+(?:\\.\\d+)?)\\s*cm', 'i'), c: 1, w: 2, h: 3, cm: true }
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
      for (var ty = 0; ty < tilesY; ty++) {
        for (var tx = 0; tx < tilesX; tx++) {
          var x0 = tx * sppW, y0 = ty * sppH;
          var cols = Math.min(sppW, W - x0), rows = Math.min(sppH, H - y0);
          var label = pageLabel(tx, ty);
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
            designW: W, designH: H, label: label
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
    setFillRGBColor: 59, setFillGray: 57, setFillCMYKColor: 61
  };

  function pdfOps() {
    var O = window.pdfjsLib && window.pdfjsLib.OPS;
    if (!O || typeof O.constructPath !== 'number') return PDF_OPS_FALLBACK;
    return {
      save: O.save, restore: O.restore, transform: O.transform,
      rectangle: O.rectangle, constructPath: O.constructPath,
      setFillRGBColor: O.setFillRGBColor, setFillGray: O.setFillGray,
      setFillCMYKColor: O.setFillCMYKColor
    };
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
  function collectRects(ops, OPS) {
    var ctm = [1, 0, 0, 1, 0, 0], stack = [], fill = '000000';
    var rects = [], sizes = {};
    var fns = ops.fnArray, args = ops.argsArray;
    for (var i = 0; i < fns.length; i++) {
      var f = fns[i], a = args[i];
      if (f === OPS.save) { stack.push(ctm.slice()); }
      else if (f === OPS.restore) { if (stack.length) ctm = stack.pop(); }
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
    return { rects: rects, sizes: sizes };
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
      out.push({ x: x, y: y, w: 1, h: 1, id: str(it.fontName, 'f') + '' + trimmed });
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
    var grid = [];
    for (var gy = 0; gy < gr; gy++) {
      for (var gx = 0; gx < gc; gx++) grid.push(sub[(gy * K) * cols + (gx * K)]);
    }
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

  /**
   * One page -> { tile } when it reads as a chart page, or
   * { pending: marks, hint, nums } when it looks like one but was too narrow
   * to fit a lattice to on its own, or null.
   */
  function extractPage(page, OPS) {
    return page.getOperatorList().then(function (ops) {
      var col = collectRects(ops, OPS);
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
        if (tile) {
          tile.source = source;
          tile.place = placeTile(tile, g.nums);
          return { tile: tile };
        }
        if (keep && keep.length >= 40 && keep.length <= 20000 && hint > 0) {
          return { pending: keep, hint: hint, nums: g.nums };
        }
        return null;
      });
    }, function () { return null; });
  }

  /** Greedy glyph -> key-entry assignment (symbol, then counts, then colour). */
  function matchGlyphs(marks, entries) {
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
      var glyph = marks[i].id.indexOf('') > 0 ? marks[i].id.split('')[1] : '';
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
      if (Math.abs(mn - en) <= Math.max(3, en * 0.03)) {
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
   *            agree, confidence, ms, pages, tiles, warnings }
   */
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
        ms: Math.round(now()), pages: 0, tiles: 0, warnings: warnings
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

    var tiles = [], pending = [], scanned = 0, misses = 0, stopped = false;

    function step(n) {
      if (n > last || stopped) return Promise.resolve();
      if (now() > budget) { pushOnce(warnings, 'gave up after ' + Math.round(budget / 1000) + ' seconds'); stopped = true; return Promise.resolve(); }
      if (typeof opts.cancelled === 'function' && opts.cancelled()) { stopped = true; return Promise.resolve(); }
      if (typeof opts.onProgress === 'function') {
        try { opts.onProgress(n - first + 1, last - first + 1); } catch (e) { /* ignore */ }
      }
      return pdf.getPage(n).then(function (page) {
        return extractPage(page, OPS);
      }, function () { return null; }).then(function (res) {
        scanned++;
        if (res && res.tile) { res.tile.page = n; tiles.push(res.tile); misses = 0; }
        else if (res && res.pending) { res.page = n; pending.push(res); misses = 0; }
        else {
          misses++;
          /* Nothing that looks like a chart in the first handful of pages:
             stop early so a PDF with no grid fails in under a second. */
          if (!tiles.length && misses >= 6 && !pageNo) { stopped = true; return; }
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
        t.place = placeTile(t, pending[p].nums);
        tiles.push(t);
      }
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

      /* ---- assemble ---- */
      var ids = [], idIndex = {}, counts = [];
      var raw = new Int32Array(W * H);
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
            if (raw[Y * W + X] < 0) counts[gi]++;
            raw[Y * W + X] = gi;
          }
        }
      }
      var filled = 0;
      for (i = 0; i < raw.length; i++) if (raw[i] >= 0) filled++;

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
          filled: filled, warnings: warnings
        };
      }

      var map = matchGlyphs(marks, entries);
      var glyphToPal = new Int16Array(ids.length);
      for (i = 0; i < ids.length; i++) {
        var e = map[ids[i]];
        glyphToPal[i] = (e === undefined) ? -1 : e;
        if (e !== undefined) matched++;
      }
      for (i = 0; i < raw.length; i++) {
        cells[i] = raw[i] < 0 ? -1 : glyphToPal[raw[i]];
      }

      /* per-entry recovered counts, for the 2% acceptance test */
      var recovered = [];
      for (i = 0; i < entries.length; i++) recovered.push(0);
      for (i = 0; i < ids.length; i++) {
        if (glyphToPal[i] >= 0) recovered[glyphToPal[i]] += counts[i];
      }
      for (i = 0; i < entries.length; i++) {
        var want = entries[i].stitchCount;
        if (want === null || want === undefined || want <= 0) continue;
        countable++;
        if (Math.abs(recovered[i] - want) <= Math.max(2, want * 0.02)) agree++;
      }

      palette = [];
      for (i = 0; i < entries.length; i++) {
        var en = entries[i];
        palette.push(normalizePaletteEntry({
          i: i, symbol: en.symbol || '', brand: en.brand || 'DMC', code: en.code,
          name: en.name || '', hex: en.hex || null,
          strands: en.strands || (key && key.strandsDefault) || 2,
          kind: en.kind || 'cross',
          stitchCount: recovered[i] || en.stitchCount || 0,
          skeins: en.skeins || 0
        }, i, (key && key.strandsDefault) || 2));
      }

      var agreePct = countable ? agree / countable : 0;
      ok = countable > 0 && agreePct >= 0.8 && W >= 10 && H >= 10;
      confidence = Math.round(Math.min(1, agreePct * (matched / Math.max(1, ids.length))) * 100) / 100;

      if (matched < ids.length) {
        pushOnce(warnings, (ids.length - matched) + ' symbol' +
          (ids.length - matched === 1 ? '' : 's') + ' could not be matched to a colour in the key');
      }
      if (!ok) {
        pushOnce(warnings, 'the stitch counts in the key only agree with the grid on ' +
          Math.round(agreePct * 100) + '% of colours');
      }

      return {
        ok: ok, w: W, h: H,
        originX: tiles[0].originX, originY: tiles[0].originY,
        cellW: tiles[0].cellW, cellH: tiles[0].cellH,
        cells: cells, glyphs: ids.slice(), counts: counts.slice(), palette: palette,
        colors: ids.length, matched: matched, agree: agree, countable: countable,
        confidence: confidence, ms: Math.round(now()), pages: scanned,
        tiles: tiles.length, filled: filled, warnings: warnings
      };
    }, function (err) {
      return fail('that PDF could not be read (' + ((err && err.message) || 'unknown error') + ')');
    });
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
    printableHTML: printableHTML,

    /* internals, exposed for test/xstitch.test.html only */
    _grid: {
      combFit: combFit,
      latticeOf: latticeOf,
      placeTile: placeTile,
      matchGlyphs: matchGlyphs,
      collectGlyphs: collectGlyphs
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
        templates: TEMPLATES
      });
    } catch (e) { /* never break the shell */ }
  }

})();
