LuckyBlox — Admin / Role badge icons
====================================

Drop badge images in THIS folder. The site serves them at:

    /assets/roles/<filename>

How the badge is chosen
-----------------------
A user's role comes from their account record (Webserver/http-db-bridge/data/users.json):

    "role": "owner"      -> uses owner.png
    "role": "admin"      -> uses admin.png
    "role": "moderator"  -> uses moderator.png

User ID 1 (tailsthehero10) is the deployment owner and shows the owner badge by
default, even without a "role" field, because ownership is set by
LUCKYBLOX_OWNER_ID / LUCKYBLOX_OWNER_USERNAME.

Files the site looks for
------------------------
Place your own images here with these exact names to have them picked up
automatically (PNG recommended, roughly square, 32-64px):

    owner.png
    admin.png
    moderator.png

If a file is missing, the site falls back to a text badge (no broken images).

About the "Roblox icon"
-----------------------
Roblox's own administrator icon is Roblox Corporation's copyrighted asset. It is
NOT included here and we do not ship or download it. If you have the right to
use a particular image, save it as owner.png (or admin.png) in this folder and
it will appear next to your username exactly like Roblox shows an admin badge.
Anything you put in this folder is yours to control.
