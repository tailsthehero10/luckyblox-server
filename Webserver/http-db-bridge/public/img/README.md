# Page imagery

## `auth-background.png`

Background image for the **sign in** and **sign up** pages.

It is served at `/img/auth-background.png` and used by both pages with a slight
blur (see `.signin-shell` in `views/signin.ejs` / `views/signup.ejs`).

To use your own image, drop it in this folder as `auth-background.png`
(or `auth-background.jpg` and update the two `background-image` rules to match).
A wide image (roughly 1920x1080 or larger) works best; it is scaled to cover the
viewport. The current file is a placeholder so the page is never blank.
