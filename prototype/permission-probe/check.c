#include <accesstoken/ability_access_control.h>
#include <stdbool.h>
#include <stdio.h>
#include <unistd.h>

int main(void)
{
    const bool dump = OH_AT_CheckSelfPermission("ohos.permission.DUMP");
    const bool mock = OH_AT_CheckSelfPermission("ohos.permission.MOCK_LOCATION");
    const bool precise = OH_AT_CheckSelfPermission("ohos.permission.LOCATION");
    const bool approximate = OH_AT_CheckSelfPermission("ohos.permission.APPROXIMATELY_LOCATION");

    printf("{\"schemaVersion\":1,\"uid\":%lu,\"dumpGranted\":%s,"
           "\"mockLocationGranted\":%s,\"preciseLocationGranted\":%s,"
           "\"approximateLocationGranted\":%s,\"locationWritesAttempted\":false}\n",
           (unsigned long)getuid(), dump ? "true" : "false", mock ? "true" : "false",
           precise ? "true" : "false", approximate ? "true" : "false");
    return 0;
}
