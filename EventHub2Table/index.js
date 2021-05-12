const azure = require('azure-storage');

// App Settings should have variables AZURE_STORAGE_ACCOUNT and AZURE_STORAGE_ACCESS_KEY, or AZURE_STORAGE_CONNECTION_STRING
const tableService = azure.createTableService();

var tableName = process.env["OutputTableName"] || "OutputTable";
var tableUpdateInterval = process.env["TableUpdateInterval"] || 5;

module.exports = async function (context, eventHubMessages) {
    // Create Table if not exists
    tableService.createTableIfNotExists(tableName, function (error, result, response) {
        if (error) {
            context.log.warn(error);
        }
    });

    var roundCoef = 60 * tableUpdateInterval; // number of seconds seconds in {tableUpdateInterval} minutes
    var updateTasks = {};

    eventHubMessages.forEach((message, index) => {
        // Extract partition key(device location and name) from the IotHub Enriched properties taken from IoTHub device twin
        var deviceLocation = context.bindingData.propertiesArray[index].deviceLocation;
        var deviceName = context.bindingData.propertiesArray[index].deviceName;
        var partitionKey = deviceLocation + '-' + deviceName;

        // Convert datetime to unix timestamp and round it
        var unixTime = Math.round(new Date(message.t).getTime() / 1000);
        var rowKey = (Math.floor(unixTime / roundCoef) * roundCoef).toString();
        
        // Check if Update Task already exists for this row, otherwise create
        if(updateTasks[partitionKey+rowKey] == null)
            {
                updateTasks[partitionKey+rowKey] = 
                {
                    PartitionKey: partitionKey,
                    RowKey: rowKey
                };
            }
       
        // Add new property to Update Task
        updateTasks[partitionKey+rowKey][message.id] = message.v;
    });

    // Proceed with all Insert/Update operations
    for(var key in updateTasks){
        var updateTask = updateTasks[key];
        context.log(updateTask);
        // Create new row or update exisitng
        tableService.insertOrMergeEntity(tableName, updateTask, function(error, result, response){
            if(error){
                context.log.warn(error);
            }
        });
    }
};