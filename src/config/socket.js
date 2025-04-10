const { Server } = require("socket.io");
const mqttModel = require("../models/mqttModel");

let io;
const lastNonZeroCache = {}; //For in-memory cache for last nonzero values

function initializeSocket(server) {
    io = new Server(server, {
        cors: {
            origin: "*",
            methods:["GET", "POST"],
        },
    });

    io.on("connection", (socket) => {
        console.log(`Client connected: ${socket.id}`);

        //Client subscribing to device ID
        socket.on("subscribeToDevice", async (deviceID) => {
            console.log(`Client subscribed to device: ${deviceID}`);
            socket.join(deviceID);

            // Fetch last 24 hours of historical data and send to the client
            const historicalData = await getLast24HoursData(deviceID);
            socket.emit("historicalData", historicalData);
        });

        

    });
}

async function sendRealTimeData(deviceID, data) {
    if(!io) {
        console.log(`[${new Date().toISOString()}] Websocket not initialized`);
        return;
    }

    if(!lastNonZeroCache[deviceID]){
        lastNonZeroCache[deviceID] = {};
    }

    const updatedData = {...data};

    await Promise.all(
        Object.keys(updatedData).map(async (key) => {
            if(updatedData[key] === 0 || updatedData[key] === null ){
                if(lastNonZeroCache[deviceID][key] !== undefined){
                    //using cached nonzero value
                    updatedData[key]= lastNonZeroCache[deviceID][key];
                } else {
                    // Fetch from DB if not in cache
                    const lastValue = await getLastNonZeroValue(deviceID, key);
                    if(lastValue!== null){
                        updatedData[key] = lastValue;
                        lastNonZeroCache[deviceID][key] = lastValue; // Store in cache
                    }
                }
            } else {
                // Updating  cache with latest non-zero values
                lastNonZeroCache[deviceID][key] = updatedData[key];
            }

            //Inserting decimal point at ten's place for temperature
            if(key === "temperature" && updatedData[key]>9){
                updatedData[key] = (updatedData[key] /10). toFixed(1);
            }
            // if (key === "temperature") {
            //     const tempStr = updatedData[key].toString(); // Convert number to string

            //     if (tempStr.length === 5) {
            //         updatedData[key] = (updatedData[key] / 1000).toFixed(2); // Example: 45123 → 45.123
            //     } else if (tempStr.length === 4) {
            //         updatedData[key] = (updatedData[key] / 100).toFixed(2); // Example: 3714 → 37.14
            //     } else if (tempStr.length === 3) {
            //         updatedData[key] = (updatedData[key] / 10).toFixed(1); // Example: 180 → 18.0
            //     }
            // }
        })
    );
    console.log(`[${new Date().toISOString()}] Emitting real-time data for device ${deviceID}:`, updatedData);
    io.to(deviceID).emit("realTimeData", updatedData);
}

//Function for fetching last nonzero value from MongoDB
async function getLastNonZeroValue(deviceID, field) {
    try {
        const record = await mqttModel.findOne({
            deviceID,
            [field]: {$ne: 0},
        })
            .sort({ createdAt: -1 })
            .exec();
            return record? record[field] : null;
    } catch(error) {
        console.error(`[${new Date().toISOString()}] Error querying non-zero value:`, error);
        return null;
    }
}

async function getLast24HoursData(deviceID) {
    try {
        const now = new Date();
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const historicalData = await mqttModel.aggregate([
            { $match: { deviceID, createdAt: { $gte: twentyFourHoursAgo } } },
            {
                $group: {
                    _id: {
                        hour: { $hour: "$createdAt" },
                        day: { $dayOfMonth: "$createdAt" },
                        month: { $month: "$createdAt" },
                        year: { $year: "$createdAt" },
                    },
                    avgRunningHours: { $avg: "$runningHours" },
                    avgSignalStrength: { $avg: "$signalStrength" },
                    avgNO2: { $avg: "$NO2" },
                    avgO2: { $avg: "$O2" },
                    avgCO: { $avg: "$CO" },
                    avgPM1: { $avg: "$PM1" },
                    avgPM2_5: { $avg: "$PM2_5" },
                    avgPM10: { $avg: "$PM10" },
                    avgTemperature: { $avg: "$temperature" },
                    avgHumidity: { $avg: "$humidity" },
                    avgVOC: { $avg: "$VOC" },
                    avgCO2: { $avg: "$CO2" },
                    avgCH2O: { $avg: "$CH2O" },
                    avgO3: { $avg: "$O3" },
                    timestamp: { $min: "$createdAt" }
                }
            },
            { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1, "_id.hour": 1 } },
            { $limit: 24 }
        ]);

        return historicalData;
    } catch (error) {
        console.log(`[${new Date().toISOString()}] Error fetching historical data`, error);
        return [];
    }
}


module.exports = {initializeSocket, sendRealTimeData};


