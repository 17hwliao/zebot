from PIL import Image, ImageDraw, ImageFilter
import numpy as np

W, H = 1117, 1409


def poly_mask(points, size=(W, H), scale=1):
    im = Image.new("L", (size[0] * scale, size[1] * scale), 0)
    d = ImageDraw.Draw(im)
    d.polygon([(x * scale, y * scale) for x, y in points], fill=255)
    if scale != 1:
        im = im.resize(size, Image.LANCZOS)
    return np.array(im) > 127


def ellipse_mask(cx, cy, rx, ry, size=(W, H)):
    im = Image.new("L", size, 0)
    ImageDraw.Draw(im).ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=255)
    return np.array(im) > 127


def rect_mask(x0, y0, x1, y1, size=(W, H)):
    m = np.zeros((size[1], size[0]), bool)
    m[max(0, y0):y1, max(0, x0):x1] = True
    return m


def dilate(mask, r=2):
    if r <= 0:
        return mask.copy()
    im = Image.fromarray((mask * 255).astype(np.uint8), "L")
    im = im.filter(ImageFilter.MaxFilter(r * 2 + 1))
    return np.array(im) > 127


def erode(mask, r=1):
    if r <= 0:
        return mask.copy()
    im = Image.fromarray((mask * 255).astype(np.uint8), "L")
    im = im.filter(ImageFilter.MinFilter(r * 2 + 1))
    return np.array(im) > 127


# Full torso + jacket silhouette (excludes background hair on shoulders)
BODY = [
    (580, 610), (655, 610), (675, 645), (710, 670), (725, 705),
    (732, 760), (745, 830), (758, 895), (754, 938), (725, 960),
    (680, 972), (615, 976), (548, 970), (496, 956), (464, 934),
    (458, 892), (470, 825), (482, 755), (492, 702), (518, 670),
    (555, 645),
]

# Tight jacket front panels (left & right lapels + hem, excluding center shirt opening)
JACKET_L = [
    (482, 690), (546, 682), (570, 725), (586, 785), (584, 860),
    (572, 956), (528, 954), (478, 942), (456, 926), (462, 872),
    (482, 795), (476, 735),
]

JACKET_R = [
    (668, 685), (726, 695), (742, 750), (754, 835), (764, 910),
    (756, 946), (712, 960), (696, 940), (682, 865), (670, 790),
    (666, 730),
]

# Left sleeve tightly traced along dark navy/white sleeve outline (no background hair)
ARM_L = [
    (486, 702), (462, 705), (432, 732), (392, 772), (348, 818),
    (316, 855), (312, 888), (322, 910), (312, 926), (336, 948),
    (368, 962), (392, 954), (418, 922), (452, 875), (482, 818),
    (494, 755),
]

# Left hand tightly traced around skin + outline (no purple hair)
HAND_L = [
    (316, 926), (294, 948), (288, 974), (304, 996), (328, 994),
    (348, 982), (368, 986), (382, 966), (386, 948), (360, 938),
]

# Right sleeve tightly traced along dark navy/white sleeve outline (no purple hair!)
ARM_R = [
    (706, 705), (734, 706), (756, 732), (788, 776), (824, 830),
    (834, 866), (824, 902), (830, 922), (804, 948), (784, 952),
    (760, 922), (736, 870), (716, 808), (704, 748),
]

# Right hand tightly traced around skin + outline (no purple hair!)
HAND_R = [
    (818, 916), (838, 942), (844, 966), (830, 984), (806, 986),
    (782, 968), (776, 946), (796, 926),
]

# Pleated skirt only (excludes hands & hair on outer sides)
SKIRT = [
    (520, 848), (696, 848), (722, 885), (752, 932), (782, 976),
    (800, 1012), (774, 1038), (722, 1058), (642, 1070), (552, 1068),
    (468, 1052), (410, 1028), (384, 1006), (402, 974), (432, 932),
    (468, 892),
]

# Legs (dark tights below skirt, strictly separated left/right)
LEG_L = [
    (448, 1025), (568, 1025), (566, 1085), (554, 1145), (548, 1205),
    (552, 1242), (450, 1242), (442, 1195), (450, 1135), (454, 1080),
]

LEG_R = [
    (614, 1025), (730, 1025), (726, 1085), (724, 1145), (730, 1205),
    (734, 1242), (628, 1242), (620, 1195), (618, 1135), (614, 1080),
]

# Full head + bangs + ahoge (no chin notch)
HEAD = [
    (400, 382), (376, 305), (392, 224), (438, 152), (498, 102), (562, 82),
    (624, 82), (684, 104), (738, 146), (778, 200), (802, 262), (818, 330),
    (824, 410), (818, 500), (802, 566), (772, 608), (728, 624), (676, 626),
    (622, 626), (568, 622), (518, 610), (478, 590), (448, 558), (426, 514),
    (410, 462), (402, 418),
]

# Complete ahoge bounding box (covers full left and right loops down to crown)
AHOGE_BOX = (412, 12, 650, 138)

# Front side hair locks framing cheeks (tightly excludes jacket/armpit)
LOCK_L = [
    (360, 448), (344, 510), (350, 568), (376, 612), (404, 652),
    (414, 686), (398, 712), (366, 718), (358, 728), (400, 734),
    (442, 716), (472, 684), (484, 640), (472, 602), (444, 578),
    (418, 540), (396, 488), (382, 444),
]

LOCK_R = [
    (842, 464), (856, 522), (848, 580), (818, 636), (798, 682),
    (806, 716), (836, 732), (814, 742), (766, 730), (738, 696),
    (730, 650), (748, 608), (778, 572), (800, 524), (816, 472),
    (828, 448),
]

# Headphones (tight earcups + collar clasp only, no jacket collar or hair)
HEADPHONE_ELLIPSES = [
    (544, 666, 49, 49),
    (680, 660, 46, 47),
]
HEADPHONE_CHARM = [
    (590, 636), (642, 636), (646, 672), (642, 706), (626, 716),
    (604, 716), (590, 704), (588, 670),
]

# Hair ornaments (full unclipped left star+bow and right double crescent moons)
ORNAMENT_BOW = [
    (292, 362), (326, 370), (356, 378), (374, 394), (380, 418),
    (370, 442), (360, 466), (336, 476), (312, 472), (288, 474),
    (272, 456), (270, 428), (276, 404), (274, 380),
]
ORNAMENT_STAR = [
    (348, 250), (364, 294), (404, 314), (368, 336), (356, 376),
    (326, 344), (296, 356), (312, 322), (302, 296), (332, 286),
]
ORNAMENT_MOON_TOP = [
    (746, 128), (774, 96), (810, 96), (834, 122), (838, 166),
    (816, 194), (778, 192), (750, 168),
]
ORNAMENT_MOON_BOTTOM = [
    (776, 200), (818, 184), (858, 200), (888, 236), (892, 282),
    (872, 318), (830, 326), (790, 308), (774, 272), (772, 232),
]

# Clean interior face region for expression blending (stays above chin/hand)
FACE_EXPRESSION_POLY = [
    (446, 392), (510, 376), (618, 372), (722, 380), (776, 404),
    (786, 466), (778, 534), (748, 578), (690, 598), (618, 602),
    (544, 596), (484, 574), (446, 526), (438, 458),
]


def body_masks():
    body = poly_mask(BODY)
    arm_l = poly_mask(ARM_L)
    arm_r = poly_mask(ARM_R)
    hand_l = poly_mask(HAND_L)
    hand_r = poly_mask(HAND_R)
    return body, arm_l, arm_r, hand_l, hand_r


def head_masks():
    head = poly_mask(HEAD) | rect_mask(*AHOGE_BOX)
    phones = np.zeros((H, W), bool)
    for cx, cy, rx, ry in HEADPHONE_ELLIPSES:
        phones |= ellipse_mask(cx, cy, rx, ry)
    phones |= poly_mask(HEADPHONE_CHARM)
    ornament = (
        poly_mask(ORNAMENT_BOW)
        | poly_mask(ORNAMENT_STAR)
        | poly_mask(ORNAMENT_MOON_TOP)
        | poly_mask(ORNAMENT_MOON_BOTTOM)
    )
    hair_front = poly_mask(LOCK_L) | poly_mask(LOCK_R)
    # No ~dilate subtraction on face_base so z-layered headphones/ornaments/locks leave ZERO seams
    face = head.copy()
    return head, phones, ornament, hair_front, face
