# AquaFarm: share records with friends (Firebase setup)

Do this once, on your iPad in Safari. It is free for a small farm (Firebase "Spark" plan).
Your friends do NOT need to do any of this. The owner (you) sets up the logins.

## A. Create the project
1. Go to **console.firebase.google.com** and sign in with a Google account.
2. **Create a project** (or "Add project"). Name it `aquafarm`. Turn Google Analytics off. Create.

## B. Turn on logins
3. In the left menu: **Build -> Authentication -> Get started**.
4. **Sign-in method -> Email/Password -> Enable -> Save**.

## C. Create the database
5. **Build -> Firestore Database -> Create database**. Pick the closest location. Choose **Start in production mode**. Enable.
6. Open the **Rules** tab. Delete what is there, paste everything from the file `firestore.rules`, and tap **Publish**.

## D. Add yourself and your friends
For each person (including you):
7. **Authentication -> Users -> Add user**. Type their email and a password. Tell them the password.
8. **Firestore Database -> Data -> Start collection**. Collection ID: `admin`. Document ID: `members`.
   Add one field: name `emails`, type **array**, and add each person's email as a string, ALL IN LOWER CASE.
   To add someone later, open admin -> members and add their email to the array.
   Always do step 7 before step 8 for a new person.

## E. Connect AquaFarm
9. Tap the gear icon next to "Project Overview" -> **Project settings** -> **General**.
10. Scroll to **Your apps** -> tap the web icon `</>` -> name it `aquafarm` -> **Register app**.
11. Copy the values for `apiKey`, `projectId` and `appId` from the code shown.
12. In your GitHub repository, open `firebase-config.js`, tap the pencil (edit), replace the four `PASTE_...` values
    (authDomain is `YOUR-PROJECT-ID.firebaseapp.com`), and **Commit changes**.
13. In Firebase: **Authentication -> Settings -> Authorized domains -> Add domain** and add `YOUR-GITHUB-USERNAME.github.io`.
14. Wait about a minute, open your AquaFarm website, open the menu (three lines), and tap **Sign in to sync**.

## Using it
- Everyone signs in with their own email and password, on any device. Records appear for everyone.
- If you are told "not allowed", the email is missing from admin/members (step 8).
- Anyone on the member list can see, change and delete all farm records. Only add people you trust.
- Sign out from the menu. A copy of the records stays on that device.
- Keep downloading backups from the Data Backup page.
