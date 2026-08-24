const express = require("express");
const fs = require("fs");
const multer = require("multer");
const path = require("path");

const app = express();

/* Load local .env without an extra dependency. Existing platform
   environment variables always take priority. */
(function loadLocalEnv() {
    try {
        const envPath = path.join(__dirname, ".env");
        const text = fs.readFileSync(envPath, "utf8");
        text.split(/\r?\n/).forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) return;
            const i = trimmed.indexOf("=");
            if (i < 1) return;
            const key = trimmed.slice(0, i).trim();
            let value = trimmed.slice(i + 1).trim();
            if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
            if (process.env[key] === undefined) process.env[key] = value;
        });
    } catch (_) {}
})();

const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "krishnaadmin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || "";

/* =====================================================
   ADMIN LOGIN SESSION
   Cookie is HttpOnly + SameSite and signed with a server
   secret. Sessions are kept in memory and expire.
===================================================== */
const adminSessions = new Map();
const SESSION_COOKIE = "kj_admin_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function safeEqual(a, b) {
    const aa = Buffer.from(String(a || ""));
    const bb = Buffer.from(String(b || ""));
    return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function parseCookies(req) {
    const raw = req.headers.cookie || "";
    const out = {};
    raw.split(";").forEach(part => {
        const index = part.indexOf("=");
        if (index < 0) return;
        const key = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();
        out[key] = decodeURIComponent(value);
    });
    return out;
}

function isAdminAuthenticated(req) {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (!token) return false;
    const session = adminSessions.get(token);
    if (!session) return false;
    if (session.expiresAt < Date.now()) {
        adminSessions.delete(token);
        return false;
    }
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    return true;
}

function setAdminCookie(res, token) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader(
        "Set-Cookie",
        `${SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${SESSION_TTL_MS / 1000}; Path=/; HttpOnly; SameSite=Lax${secure}`
    );
}

function clearAdminCookie(res) {
    res.setHeader(
        "Set-Cookie",
        `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`
    );
}

function adminAuth(req, res, next) {
    if (isAdminAuthenticated(req)) return next();

    if (req.path === "/login.html" || req.path === "/login" || req.path === "/logout") {
        return next();
    }

    if (req.method === "GET" && req.path.endsWith(".html")) {
        return res.redirect("/admin/login.html");
    }

    return res.status(401).json({
        success: false,
        message: "Admin login required.",
        loginRequired: true
    });
}

function requireConfiguredAdmin(req, res, next) {
    if (!ADMIN_PASSWORD || !ADMIN_SESSION_SECRET) {
        return res.status(503).json({
            success: false,
            message: "Admin security is not configured. Set ADMIN_PASSWORD and ADMIN_SESSION_SECRET."
        });
    }
    next();
}


const DATA_FILE = path.join(__dirname, "data.json");

const imagesFolder =
    path.join(__dirname, "images");


/* =====================================================
   CREATE IMAGES FOLDER
===================================================== */

if (!fs.existsSync(imagesFolder)) {

    fs.mkdirSync(
        imagesFolder,
        { recursive: true }
    );

}


/* =====================================================
   BASIC SETUP
===================================================== */

app.use(express.json({ limit: "100kb" }));

/* =====================================================
   BASIC SECURITY HEADERS
===================================================== */

app.disable("x-powered-by");

app.use((req, res, next) => {

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

    next();

});


/* =====================================================
   HEALTH CHECK
===================================================== */

app.get("/api/health", (req, res) => {

    res.json({
        success: true,
        service: "Krishna Jewellers",
        status: "ok",
        timestamp: new Date().toISOString()
    });

});




/* =====================================================
   IMAGE UPLOAD
===================================================== */

const storage =
    multer.diskStorage({

        destination: function (
            req,
            file,
            cb
        ) {

            cb(
                null,
                imagesFolder
            );

        },

        filename: function (
            req,
            file,
            cb
        ) {

            const ext =
                path.extname(
                    file.originalname
                ).toLowerCase();


            const name =
                path.basename(
                    file.originalname,
                    ext
                )
                .replace(
                    /[^a-z0-9-_]/gi,
                    "-"
                );


            cb(
                null,
                `${Date.now()}-${name}${ext}`
            );

        }

    });


const upload =
    multer({

        storage: storage,

        limits: {

            fileSize:
                8 * 1024 * 1024

        },

        fileFilter:
            function (
                req,
                file,
                cb
            ) {

                const allowed = [

                    "image/jpeg",

                    "image/png",

                    "image/webp"

                ];


                const extension =
                    path.extname(file.originalname).toLowerCase();

                const extensionAllowed = [
                    ".jpg",
                    ".jpeg",
                    ".png",
                    ".webp"
                ].includes(extension);

                if (
                    allowed.includes(file.mimetype) &&
                    extensionAllowed
                ) {

                    cb(
                        null,
                        true
                    );

                } else {

                    cb(
                        new Error(
                            "Only JPG, PNG and WEBP images are allowed."
                        )
                    );

                }

            }

    });


/* =====================================================
   READ DATA
===================================================== */

function readData() {

    const emptyData = {

        goldRates: {

            "24K": 0,

            "22K": 0,

            "18K": 0

        },

        updatedAt: null,

        categories: [],

        jewellery: []

    };


    try {

        if (
            !fs.existsSync(
                DATA_FILE
            )
        ) {

            return emptyData;

        }


        const data =
            JSON.parse(
                fs.readFileSync(
                    DATA_FILE,
                    "utf8"
                )
            );


        return {

            ...emptyData,

            ...data,

            goldRates: {

                ...emptyData.goldRates,

                ...(data.goldRates || {})

            },

            categories:

                Array.isArray(
                    data.categories
                )
                    ? data.categories
                    : [],

            jewellery:

                Array.isArray(
                    data.jewellery
                )
                    ? data.jewellery
                    : []

        };

    } catch (error) {

        console.log(
            "Could not read data.json:",
            error.message
        );

        return emptyData;

    }

}


/* =====================================================
   SAVE DATA
===================================================== */

function saveData(data) {

    const tempFile = DATA_FILE + ".tmp";

    fs.writeFileSync(

        tempFile,

        JSON.stringify(
            data,
            null,
            4
        ),

        "utf8"

    );

    fs.renameSync(
        tempFile,
        DATA_FILE
    );

}


/* =====================================================
   ADMIN LOGIN / LOGOUT
===================================================== */

app.get("/admin", (req, res) => {
    if (isAdminAuthenticated(req)) {
        return res.redirect("/admin/index.html");
    }
    res.redirect("/admin/login.html");
});

app.get("/admin/login", (req, res) => {
    if (isAdminAuthenticated(req)) {
        return res.redirect("/admin/index.html");
    }
    res.sendFile(path.join(__dirname, "admin", "login.html"));
});

app.get("/admin/login.html", (req, res) => {
    if (isAdminAuthenticated(req)) {
        return res.redirect("/admin/index.html");
    }
    res.sendFile(path.join(__dirname, "admin", "login.html"));
});

app.post("/api/admin/login", requireConfiguredAdmin, (req, res) => {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!safeEqual(username, ADMIN_USERNAME) || !safeEqual(password, ADMIN_PASSWORD)) {
        return res.status(401).json({
            success: false,
            message: "Invalid Admin ID or Password."
        });
    }

    const token = crypto.randomBytes(32).toString("hex");
    adminSessions.set(token, {
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_TTL_MS
    });
    setAdminCookie(res, token);

    res.json({
        success: true,
        message: "Login successful."
    });
});

app.post("/api/admin/logout", (req, res) => {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) adminSessions.delete(token);
    clearAdminCookie(res);
    res.json({ success: true, message: "Logged out successfully." });
});

app.get("/admin/logout", (req, res) => {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) adminSessions.delete(token);
    clearAdminCookie(res);
    res.redirect("/admin/login.html");
});

app.get("/api/admin/me", (req, res) => {
    res.json({ success: isAdminAuthenticated(req) });
});

/* =====================================================
   ADMIN PROTECTION
===================================================== */

app.use("/admin", adminAuth);

app.use("/api", (req, res, next) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
        // Login/logout are intentionally public and were registered above.
        if (req.path === "/admin/login" || req.path === "/admin/logout") return next();
        return adminAuth(req, res, next);
    }
    next();
});


/* =====================================================
   LIVE GOLD
===================================================== */

const PANKAJ_LIVE_URL =
    "https://bcast.pankajchain.com:7768/VOTSBroadcastStreaming/Services/xml/GetLiveRateByTemplateID/pankajchain";


/* =====================================================
   GET LIVE LOCAL GOLD RATE
===================================================== */

async function getLiveLocalGoldRate() {

    const url =
        PANKAJ_LIVE_URL +
        "?_=" +
        Date.now();


    const response =
        await fetch(
            url,
            {

                signal: AbortSignal.timeout(5000),

                headers: {

                    "Accept":
                        "text/plain, */*; q=0.01",

                    "Referer":
                        "https://pankajchain.com/",

                    "User-Agent":
                        "Mozilla/5.0"

                }

            }
        );


    if (!response.ok) {

        throw new Error(
            `Live gold feed error: ${response.status}`
        );

    }


    const text =
        await response.text();


    /*
       6335 = GOLD 99.50 CASH BHAV

       BUY
       SELL
       HIGH
       LOW
    */

    const match =
        text.match(
            /6335\s+GOLD\s+99\.50\s+CASH\s+BHAV\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/i
        );


    if (!match) {

        console.log(
            "Could not find GOLD 99.50 CASH BHAV."
        );

        throw new Error(
            "99.50 Cash Bhav not found in live feed."
        );

    }


    return {

        buy:
            Number(match[1]),

        sell:
            Number(match[2]),

        high:
            Number(match[3]),

        low:
            Number(match[4])

    };

}


/* =====================================================
   API - LIVE GOLD RATE
===================================================== */

app.get(
    "/api/gold-rates",
    async (req, res) => {

        try {

            const rate =
                await getLiveLocalGoldRate();


            const rate24 =
                Math.round(
                    rate.sell
                );


            const rate22 =
                Math.round(
                    rate24 * 22 / 24
                );


            const rate18 =
                Math.round(
                    rate24 * 18 / 24
                );


            res.json({

                success: true,

                goldRates: {

                    "24K":
                        rate24,

                    "22K":
                        rate22,

                    "18K":
                        rate18

                },

                buy:
                    rate.buy,

                sell:
                    rate.sell,

                high:
                    rate.high,

                low:
                    rate.low,

                unit:
                    "per 10 gram",

                purity:
                    "24K",

                source:
                    "Pankaj Chain live feed",

                updatedAt:
                    new Date().toISOString()

            });

        } catch (error) {

            console.error(
                "Live gold rate error:",
                error.message
            );


            /*
               Agar live feed temporarily
               unavailable ho to saved rate
               return karenge.
            */

            const data =
                readData();


            res.json({

                success: true,

                fallback: true,

                goldRates:
                    data.goldRates,

                unit:
                    "per 10 gram",

                source:
                    "Saved rate",

                updatedAt:
                    data.updatedAt

            });

        }

    }
);


/* =====================================================
   SAVE GOLD RATES
===================================================== */

app.post(
    "/api/gold-rates",
    (req, res) => {

        const rate24 =
            Number(
                req.body.rate24
            );

        const rate22 =
            Number(
                req.body.rate22
            );

        const rate18 =
            Number(
                req.body.rate18
            );


        if (
            !Number.isFinite(rate24) ||
            !Number.isFinite(rate22) ||
            !Number.isFinite(rate18)
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Please enter valid gold rates."

            });

        }


        const data =
            readData();


        data.goldRates = {

            "24K":
                rate24,

            "22K":
                rate22,

            "18K":
                rate18

        };


        data.updatedAt =
            new Date().toISOString();


        saveData(data);


        res.json({

            success: true,

            message:
                "Gold rates saved successfully.",

            goldRates:
                data.goldRates,

            updatedAt:
                data.updatedAt

        });

    }
);


/* =====================================================
   CATEGORIES
===================================================== */


/* GET CATEGORIES */

app.get(
    "/api/categories",
    (req, res) => {

        const data =
            readData();


        /* Prevent browser caching */

        res.set(
            "Cache-Control",
            "no-store, no-cache, must-revalidate, proxy-revalidate"
        );


        res.json({

            success: true,

            categories:
                data.categories

        });

    }
);


/* =====================================================
   ADD CATEGORY
===================================================== */

/* =====================================================
   ADD CATEGORY
   CATEGORY NAME + CATEGORY PHOTO
===================================================== */

app.post(
    "/api/categories",
    upload.single("image"),
    (req, res) => {

        const name =
            String(
                req.body.name || ""
            ).trim();


        /* =================================================
           CATEGORY NAME CHECK
        ================================================= */

        if (!name) {

            return res.status(400).json({

                success: false,

                message:
                    "Category name is required."

            });

        }


        /* =================================================
           CATEGORY PHOTO CHECK
        ================================================= */

        if (!req.file) {

            return res.status(400).json({

                success: false,

                message:
                    "Please select a category photo."

            });

        }


        const data =
            readData();


        /* =================================================
           DUPLICATE CATEGORY CHECK
        ================================================= */

       const exists =
    data.categories.some(
        category => {

            if (!category) {
                return false;
            }

            const categoryName =
                typeof category === "string"
                    ? category
                    : category.name;

            if (!categoryName) {
                return false;
            }

            return (
                String(categoryName)
                    .toLowerCase()
                    .trim() ===
                name.toLowerCase()
                    .trim()
            );

        }
    );


        if (exists) {

            /*
               Agar duplicate category hai
               to uploaded photo delete kar denge.
            */

            try {

                fs.unlinkSync(
                    req.file.path
                );

            } catch (error) {

                console.log(
                    "Could not remove duplicate category image:",
                    error.message
                );

            }


            return res.status(400).json({

                success: false,

                message:
                    "Category already exists."

            });

        }


        /* =================================================
           SAVE CATEGORY
        ================================================= */

        const category = {

            name:
                name,

            image:
                "images/" +
                req.file.filename,

            synonyms:
                []

        };


        data.categories.push(
            category
        );


        saveData(data);


        /* =================================================
           RESPONSE
        ================================================= */

        res.json({

            success: true,

            message:
                "Category added successfully.",

            category:
                category,

            categories:
                data.categories

        });

    }
);


/* =====================================================
   RENAME CATEGORY
===================================================== */

app.put(
    "/api/categories/:name",
    (req, res) => {

        const oldName =
            decodeURIComponent(
                req.params.name
            );


        const newName =
            String(
                req.body.newName || ""
            ).trim();


        if (!newName) {

            return res.status(400).json({

                success: false,

                message:
                    "New category name is required."

            });

        }


        const data =
            readData();


        const index =
            data.categories.findIndex(
                category => {

                    const categoryName =
                        typeof category === "string"
                            ? category
                            : category.name;


                    return (
                        String(categoryName)
                            .toLowerCase() ===
                        oldName.toLowerCase()
                    );

                }
            );


        if (index < 0) {

            return res.status(404).json({

                success: false,

                message:
                    "Category not found."

            });

        }


        const alreadyExists =
            data.categories.some(
                (category, i) => {

                    if (i === index) {

                        return false;

                    }


                    const categoryName =
                        typeof category === "string"
                            ? category
                            : category.name;


                    return (
                        String(categoryName)
                            .toLowerCase() ===
                        newName.toLowerCase()
                    );

                }
            );


        if (alreadyExists) {

            return res.status(400).json({

                success: false,

                message:
                    "Category already exists."

            });

        }


        /*
           Preserve synonyms while renaming.
        */

        const oldCategory =
            data.categories[index];


        if (
            typeof oldCategory ===
            "string"
        ) {

            data.categories[index] = {

                name:
                    newName,

                synonyms:
                    []

            };

        } else {

            data.categories[index] = {

                ...oldCategory,

                name:
                    newName,

                synonyms:
                    Array.isArray(
                        oldCategory.synonyms
                    )
                        ? oldCategory.synonyms
                        : []

            };

        }


        /*
           Update jewellery category
           references.
        */

        data.jewellery.forEach(
            item => {

                if (
                    String(
                        item.category || ""
                    ).toLowerCase() ===
                    oldName.toLowerCase()
                ) {

                    item.category =
                        newName;

                }

            }
        );


        saveData(data);


        res.json({

            success: true,

            message:
                "Category renamed successfully.",

            categories:
                data.categories

        });

    }
);




/* =====================================================
   CHANGE CATEGORY PHOTO
===================================================== */

app.put(
    "/api/categories/:name/image",
    upload.single("image"),
    (req, res) => {

        try {

            const name =
                decodeURIComponent(
                    req.params.name
                ).trim();


            /* =========================
               PHOTO CHECK
            ========================= */

            if (!req.file) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Please select a category photo."

                });

            }


            /* =========================
               READ DATA
            ========================= */

            const data =
                readData();


            /* =========================
               FIND CATEGORY
            ========================= */

            const index =
                data.categories.findIndex(
                    category => {

                        const categoryName =
                            typeof category === "string"
                                ? category
                                : category?.name;

                        return (
                            String(
                                categoryName || ""
                            )
                            .trim()
                            .toLowerCase() ===
                            name.toLowerCase()
                        );

                    }
                );


            /* =========================
               CATEGORY NOT FOUND
            ========================= */

            if (index === -1) {

                try {

                    fs.unlinkSync(
                        req.file.path
                    );

                } catch (error) {

                    console.log(
                        "Could not remove uploaded image:",
                        error.message
                    );

                }


                return res.status(404).json({

                    success: false,

                    message:
                        "Category not found."

                });

            }


            /* =========================
               OLD CATEGORY
            ========================= */

            const oldCategory =
                data.categories[index];


            /* =========================
               OLD IMAGE
            ========================= */

            const oldImage =
                typeof oldCategory === "object"
                    ? oldCategory.image
                    : null;


            /* =========================
               NEW IMAGE PATH
            ========================= */

            const newImage =
                "images/" +
                req.file.filename;


            /* =========================
               UPDATE CATEGORY
            ========================= */

            if (
                typeof oldCategory === "string"
            ) {

                data.categories[index] = {

                    name:
                        oldCategory,

                    image:
                        newImage,

                    synonyms:
                        []

                };

            } else {

                data.categories[index] = {

                    ...oldCategory,

                    name:
                        oldCategory.name,

                    image:
                        newImage,

                    synonyms:
                        Array.isArray(
                            oldCategory.synonyms
                        )
                            ? oldCategory.synonyms
                            : []

                };

            }


            /* =========================
               SAVE DATA
            ========================= */

            saveData(data);


            /* =========================
               DELETE OLD IMAGE
            ========================= */

            if (
                oldImage &&
                oldImage !== newImage
            ) {

                const oldImagePath =
                    path.join(
                        __dirname,
                        oldImage
                    );


                try {

                    if (
                        fs.existsSync(
                            oldImagePath
                        )
                    ) {

                        fs.unlinkSync(
                            oldImagePath
                        );

                    }

                } catch (error) {

                    console.log(
                        "Could not delete old category image:",
                        error.message
                    );

                }

            }


            /* =========================
               SUCCESS
            ========================= */

            return res.json({

                success: true,

                message:
                    "Category photo changed successfully.",

                category:
                    data.categories[index]

            });


        } catch (error) {

            console.error(
                "Change category photo error:",
                error
            );


            /* =========================
               DELETE NEW IMAGE
               IF SOMETHING FAILED
            ========================= */

            if (
                req.file &&
                req.file.path
            ) {

                try {

                    if (
                        fs.existsSync(
                            req.file.path
                        )
                    ) {

                        fs.unlinkSync(
                            req.file.path
                        );

                    }

                } catch (deleteError) {

                    console.log(
                        "Could not remove failed upload:",
                        deleteError.message
                    );

                }

            }


            return res.status(500).json({

                success: false,

                message:
                    error.message ||
                    "Could not change category photo."

            });

        }

    }
);



/* =====================================================
   DELETE CATEGORY
===================================================== */

/* =====================================================
   DELETE CATEGORY
   CATEGORY + ITS JEWELLERY + CATEGORY IMAGE
===================================================== */

app.delete(
    "/api/categories/:name",
    (req, res) => {

        try {

            const name =
                decodeURIComponent(
                    req.params.name
                ).trim();


            const data =
                readData();


            /* =================================================
               FIND CATEGORY
            ================================================= */

            const categoryIndex =
                data.categories.findIndex(
                    category => {

                        const categoryName =
                            typeof category === "string"
                                ? category
                                : category?.name;

                        return (
                            String(categoryName || "")
                                .trim()
                                .toLowerCase() ===
                            name.toLowerCase()
                        );

                    }
                );


            /* =================================================
               CATEGORY NOT FOUND
            ================================================= */

            if (categoryIndex === -1) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Category not found."

                });

            }


            /* =================================================
               GET CATEGORY
            ================================================= */

            const category =
                data.categories[categoryIndex];


            /* =================================================
               CATEGORY IMAGE
            ================================================= */

            const categoryImage =
                typeof category === "object"
                    ? category.image
                    : null;


            /* =================================================
               DELETE JEWELLERY OF THIS CATEGORY
            ================================================= */

            const jewelleryToDelete =
                data.jewellery.filter(
                    item => {

                        return (
                            String(
                                item.category || ""
                            )
                            .trim()
                            .toLowerCase() ===
                            name.toLowerCase()
                        );

                    }
                );


            data.jewellery =
                data.jewellery.filter(
                    item => {

                        return (
                            String(
                                item.category || ""
                            )
                            .trim()
                            .toLowerCase() !==
                            name.toLowerCase()
                        );

                    }
                );


            /* =================================================
               DELETE CATEGORY
            ================================================= */

            data.categories.splice(
                categoryIndex,
                1
            );


            /* =================================================
               SAVE DATA
            ================================================= */

            saveData(data);


            /* =================================================
               DELETE CATEGORY IMAGE
            ================================================= */

            if (categoryImage) {

                const imagePath =
                    path.join(
                        __dirname,
                        categoryImage
                    );


                try {

                    if (
                        fs.existsSync(
                            imagePath
                        )
                    ) {

                        fs.unlinkSync(
                            imagePath
                        );

                    }

                } catch (imageError) {

                    console.log(
                        "Could not delete category image:",
                        imageError.message
                    );

                }

            }


            /* =================================================
               DELETE JEWELLERY IMAGES
            ================================================= */

            jewelleryToDelete.forEach(
                item => {

                    if (
                        !Array.isArray(
                            item.images
                        )
                    ) {

                        return;

                    }


                    item.images.forEach(
                        image => {

                            if (
                                !image ||
                                typeof image !== "string"
                            ) {

                                return;

                            }


                            const imagePath =
                                path.join(
                                    __dirname,
                                    image
                                );


                            try {

                                if (
                                    fs.existsSync(
                                        imagePath
                                    )
                                ) {

                                    fs.unlinkSync(
                                        imagePath
                                    );

                                }

                            } catch (imageError) {

                                console.log(
                                    "Could not delete jewellery image:",
                                    imageError.message
                                );

                            }

                        }
                    );

                }
            );


            /* =================================================
               SUCCESS
            ================================================= */

            return res.json({

                success: true,

                message:
                    jewelleryToDelete.length > 0

                        ? `Category "${name}" and ${jewelleryToDelete.length} jewellery design(s) deleted successfully.`

                        : `Category "${name}" deleted successfully.`,

                deletedCategory:
                    name,

                deletedJewellery:
                    jewelleryToDelete.length

            });


        } catch (error) {

            console.error(
                "Delete category error:",
                error
            );


            return res.status(500).json({

                success: false,

                message:
                    error.message ||
                    "Could not delete category."

            });

        }

    }
);


/* =====================================================
   CATEGORY SYNONYMS
===================================================== */


/*
   GET SYNONYMS

   Example:

   /api/categories/Rings/synonyms
*/

app.get(
    "/api/categories/:name/synonyms",
    (req, res) => {

        const name =
            decodeURIComponent(
                req.params.name
            );


        const data =
            readData();


        const category =
            data.categories.find(
                item => {

                    const categoryName =
                        typeof item === "string"
                            ? item
                            : item.name;


                    return (
                        String(categoryName)
                            .toLowerCase() ===
                        name.toLowerCase()
                    );

                }
            );


        if (!category) {

            return res.status(404).json({

                success: false,

                message:
                    "Category not found."

            });

        }


        const synonyms =
            typeof category === "string"
                ? []
                : (
                    Array.isArray(
                        category.synonyms
                    )
                        ? category.synonyms
                        : []
                );


        res.json({

            success: true,

            synonyms:
                synonyms

        });

    }
);


/*
   SAVE SYNONYMS

   Body:

   {
       synonyms: [
           "Jhumka",
           "Earrings",
           "झुमका"
       ]
   }
*/

app.put(
    "/api/categories/:name/synonyms",
    (req, res) => {

        const name =
            decodeURIComponent(
                req.params.name
            );


        const synonyms =
            Array.isArray(
                req.body.synonyms
            )
                ? req.body.synonyms
                : [];


        const cleanSynonyms =
            synonyms
                .map(
                    synonym =>
                        String(
                            synonym || ""
                        ).trim()
                )
                .filter(Boolean)
                .filter(
                    (
                        synonym,
                        index,
                        array
                    ) =>
                        array.findIndex(
                            item =>
                                item.toLowerCase() ===
                                synonym.toLowerCase()
                        ) === index
                );


        const data =
            readData();


        const index =
            data.categories.findIndex(
                category => {

                    const categoryName =
                        typeof category === "string"
                            ? category
                            : category.name;


                    return (
                        String(categoryName)
                            .toLowerCase() ===
                        name.toLowerCase()
                    );

                }
            );


        if (index < 0) {

            return res.status(404).json({

                success: false,

                message:
                    "Category not found."

            });

        }


        const category =
            data.categories[index];


        if (
            typeof category === "string"
        ) {

            data.categories[index] = {

                name:
                    category,

                synonyms:
                    cleanSynonyms

            };

        } else {

            data.categories[index] = {

                ...category,

                synonyms:
                    cleanSynonyms

            };

        }


        saveData(data);


        res.json({

            success: true,

            message:
                "Category synonyms saved successfully.",

            synonyms:
                cleanSynonyms

        });

    }
);


/* =====================================================
   JEWELLERY
===================================================== */


/* GET JEWELLERY */

/* =====================================================
   JEWELLERY
===================================================== */


/* =====================================================
   GET JEWELLERY
   PAGINATION
===================================================== */

app.get(
    "/api/jewellery",
    (req, res) => {

        const data =
            readData();


        const total =
            data.jewellery.length;


        const requestedPage =
            Number.parseInt(
                req.query.page,
                10
            );


        const requestedLimit =
            Number.parseInt(
                req.query.limit,
                10
            );


        const page =
            Number.isFinite(
                requestedPage
            ) &&
            requestedPage > 0
                ? requestedPage
                : 1;


        /*
           Default:
           30 products per request

           Maximum:
           100 products
        */

        const limit =
            Number.isFinite(
                requestedLimit
            ) &&
            requestedLimit > 0
                ? Math.min(
                    requestedLimit,
                    100
                )
                : 30;


        const start =
            (page - 1) * limit;


        const jewellery =
            data.jewellery.slice(
                start,
                start + limit
            );


        const hasMore =
            start + jewellery.length <
            total;


        res.set(
            "Cache-Control",
            "no-store"
        );


        res.json({

            success: true,

            jewellery:
                jewellery,

            pagination: {

                page:
                    page,

                limit:
                    limit,

                total:
                    total,

                hasMore:
                    hasMore,

                nextPage:
                    hasMore
                        ? page + 1
                        : null

            }

        });

    }
);


/* =====================================================
   ADD JEWELLERY
===================================================== */

app.post(
    "/api/jewellery",
    (req, res) => {

        const {

            name,

            category,

            weight,

            description,

            images,

            synonyms

        } = req.body;


        if (

            !String(
                name || ""
            ).trim() ||

            !String(
                category || ""
            ).trim()

        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Jewellery name and category are required."

            });

        }


        const data =
            readData();


        /*
           Clean synonyms.
        */

        const cleanSynonyms =
            Array.isArray(
                synonyms
            )
                ? synonyms
                    .map(
                        synonym =>
                            String(
                                synonym || ""
                            ).trim()
                    )
                    .filter(Boolean)
                    .filter(
                        (
                            synonym,
                            index,
                            array
                        ) =>
                            array.findIndex(
                                item =>
                                    item.toLowerCase() ===
                                    synonym.toLowerCase()
                            ) === index
                    )
                : [];


        const item = {

            id:
                Date.now(),

            name:
                String(
                    name
                ).trim(),

            category:
                String(
                    category
                ).trim(),

            weight:
                String(
                    weight || ""
                ).trim(),

            description:
                String(
                    description || ""
                ).trim(),

            images:
                Array.isArray(
                    images
                )
                    ? images
                    : [],

            synonyms:
                cleanSynonyms

        };


        data.jewellery.push(
            item
        );


        saveData(data);


        res.json({

            success: true,

            message:
                "Jewellery added successfully.",

            jewellery:
                item

        });

    }
);


/* =====================================================
   EDIT JEWELLERY
===================================================== */

app.put(
    "/api/jewellery/:id",
    (req, res) => {

        const id =
            Number(
                req.params.id
            );


        const data =
            readData();


        const index =
            data.jewellery.findIndex(
                item =>
                    item.id === id
            );


        if (index < 0) {

            return res.status(404).json({

                success: false,

                message:
                    "Jewellery not found."

            });

        }


        const oldItem =
            data.jewellery[index];


        let updatedSynonyms =
            oldItem.synonyms;


        if (
            Array.isArray(
                req.body.synonyms
            )
        ) {

            updatedSynonyms =
                req.body.synonyms
                    .map(
                        synonym =>
                            String(
                                synonym || ""
                            ).trim()
                    )
                    .filter(Boolean)
                    .filter(
                        (
                            synonym,
                            index,
                            array
                        ) =>
                            array.findIndex(
                                item =>
                                    item.toLowerCase() ===
                                    synonym.toLowerCase()
                            ) === index
                    );

        }


        data.jewellery[index] = {

            ...oldItem,

            ...req.body,

            id,

            synonyms:
                Array.isArray(
                    updatedSynonyms
                )
                    ? updatedSynonyms
                    : []

        };


        saveData(data);


        res.json({

            success: true,

            message:
                "Jewellery updated successfully.",

            jewellery:
                data.jewellery[index]

        });

    }
);


/* =====================================================
   DELETE JEWELLERY
===================================================== */

app.delete(
    "/api/jewellery/:id",
    (req, res) => {

        const id =
            Number(
                req.params.id
            );


        const data =
            readData();


        const oldLength =
            data.jewellery.length;


        data.jewellery =
            data.jewellery.filter(
                item =>
                    item.id !== id
            );


        if (
            oldLength ===
            data.jewellery.length
        ) {

            return res.status(404).json({

                success: false,

                message:
                    "Jewellery not found."

            });

        }


        saveData(data);


        res.json({

            success: true,

            message:
                "Jewellery deleted successfully."

        });

    }
);


/* =====================================================
   JEWELLERY SYNONYMS
===================================================== */


/*
   GET JEWELLERY SYNONYMS
*/

app.get(
    "/api/jewellery/:id/synonyms",
    (req, res) => {

        const id =
            Number(
                req.params.id
            );


        const data =
            readData();


        const item =
            data.jewellery.find(
                jewellery =>
                    jewellery.id === id
            );


        if (!item) {

            return res.status(404).json({

                success: false,

                message:
                    "Jewellery not found."

            });

        }


        res.json({

            success: true,

            synonyms:
                Array.isArray(
                    item.synonyms
                )
                    ? item.synonyms
                    : []

        });

    }
);


/*
   SAVE JEWELLERY SYNONYMS
*/

app.put(
    "/api/jewellery/:id/synonyms",
    (req, res) => {

        const id =
            Number(
                req.params.id
            );


        const synonyms =
            Array.isArray(
                req.body.synonyms
            )
                ? req.body.synonyms
                : [];


        const cleanSynonyms =
            synonyms
                .map(
                    synonym =>
                        String(
                            synonym || ""
                        ).trim()
                )
                .filter(Boolean)
                .filter(
                    (
                        synonym,
                        index,
                        array
                    ) =>
                        array.findIndex(
                            item =>
                                item.toLowerCase() ===
                                synonym.toLowerCase()
                        ) === index
                );


        const data =
            readData();


        const index =
            data.jewellery.findIndex(
                item =>
                    item.id === id
            );


        if (index < 0) {

            return res.status(404).json({

                success: false,

                message:
                    "Jewellery not found."

            });

        }


        data.jewellery[index].synonyms =
            cleanSynonyms;


        saveData(data);


        res.json({

            success: true,

            message:
                "Jewellery synonyms saved successfully.",

            synonyms:
                cleanSynonyms

        });

    }
);


/* =====================================================
   SEARCH JEWELLERY
===================================================== */

/*
   Search will support:

   Jewellery name
   Category
   Jewellery synonyms
   Category synonyms

   Example:

   Jhumka
   Earrings
   Bali
   झुमका

   sabse same jewellery mil sakti hai.
*/

app.get(
    "/api/search",
    (req, res) => {

        const query =
            String(
                req.query.q || ""
            )
            .trim()
            .toLowerCase();


        if (!query) {

            return res.json({

                success: true,

                jewellery: []

            });

        }


        const data =
            readData();


        const results =
            data.jewellery.filter(
                item => {

                    const searchable = [];


                    /*
                       Jewellery name
                    */

                    searchable.push(
                        String(
                            item.name || ""
                        )
                    );


                    /*
                       Jewellery category
                    */

                    searchable.push(
                        String(
                            item.category || ""
                        )
                    );


                    /*
                       Jewellery synonyms
                    */

                    if (
                        Array.isArray(
                            item.synonyms
                        )
                    ) {

                        searchable.push(
                            ...item.synonyms
                        );

                    }


                    /*
                       Category synonyms
                    */

                    const category =
                        data.categories.find(
                            cat => {

                                const categoryName =
                                    typeof cat === "string"
                                        ? cat
                                        : cat.name;


                                return (
                                    String(
                                        categoryName || ""
                                    ).toLowerCase() ===
                                    String(
                                        item.category || ""
                                    ).toLowerCase()
                                );

                            }
                        );


                    if (
                        category &&
                        typeof category !== "string" &&
                        Array.isArray(
                            category.synonyms
                        )
                    ) {

                        searchable.push(
                            ...category.synonyms
                        );

                    }


                    /*
                       Description
                    */

                    searchable.push(
                        String(
                            item.description || ""
                        )
                    );


                    /*
                       Match
                    */

                    return searchable.some(
                        value => {

                            return String(
                                value || ""
                            )
                            .toLowerCase()
                            .includes(query);

                        }
                    );

                }
            );


        res.json({

            success: true,

            query,

            jewellery:
                results

        });

    }
);


/* =====================================================
   UPLOAD IMAGE
===================================================== */

app.post(
    "/api/upload-image",
    upload.single("image"),
    (req, res) => {

        if (!req.file) {

            return res.status(400).json({

                success: false,

                message:
                    "Only JPG, PNG and WEBP images up to 8MB are allowed."

            });

        }


        res.json({

            success: true,

            message:
                "Image uploaded successfully.",

            image:
                "images/" +
                req.file.filename

        });

    }
);



/* =====================================================
   ADMIN URL COMPATIBILITY
===================================================== */

app.get(
    "/admin/admin.html",
    (req, res) => {
        res.redirect("/admin/index.html");
    }
);


/* =====================================================
   SERVE WEBSITE FILES
===================================================== */

app.use(express.static(__dirname, {
    maxAge: "7d",
    etag: true,
    index: "index.html"
}));


/* =====================================================
   API NOT FOUND
===================================================== */

app.use(
    "/api",
    (req, res) => {

        res.status(404).json({

            success: false,

            message:
                "API endpoint not found."

        });

    }
);

/* =====================================================
   ERROR HANDLER
===================================================== */

app.use(
    (
        err,
        req,
        res,
        next
    ) => {

        console.error(
            err
        );


        res.status(500).json({

            success: false,

            message:
                err.message ||
                "Server error."

        });

    }
);





/* =====================================================
   START SERVER
===================================================== */

app.listen(
    PORT,
    () => {

        console.log(
            `Krishna Jewellers website running at http://localhost:${PORT}`
        );

        console.log(
            `Admin panel: http://localhost:${PORT}/admin/index.html`
        );

    }
);