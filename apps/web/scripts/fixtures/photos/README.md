# Test body photos (authorized)

Real photos used ONLY by the automated browser tests to exercise the local pose validator.
Source: Unsplash (Unsplash License: free use, modification allowed), upscaled 2x to pass the 600 px minimum.
Same files listed in `assets-src/unsplash` of the StylAI workspace; photographer credits in
`prototipo-mobile/legacy/README.v1.md` (blazer shoot: Alina Matveycheva, @alinamatveycheva).

| File | Source id | Expected |
| --- | --- | --- |
| front.jpg | 1747817330504-b41d0bbcca9a | front, full body -> approved |
| side.jpg | 1747817230322-c7015f0b0232 | ~36° -> approved as three-quarter |
| profile.jpg | 1747814896398-bdf36d11f596 | profile, full body -> approved |
| selfie.jpg | 1747817230318-f17da1d7b766 | close crop -> needs adjustment (legs missing) |
| two-people.jpg | composite of front.jpg + 1614786269829-d24616faf56d | two people -> needs adjustment |

These photos are of real people; they are test inputs, never shown as the user's photos in the product.
| front-exif6.jpg | front.jpg stored sideways with EXIF Orientation=6 (like a phone) | normalized on the server -> approved |
| front-tight-top.jpg | front.jpg with 20% removed from the top (whole head, hair ~2% below the border) | approved with advice (head_margin_small) |
| profile-head-cut.jpg | profile.jpg with 16% removed from the top (hair crosses the border) | needs adjustment (head_cut) |
